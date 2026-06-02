import { mkdtemp, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { downloadObjectToFile, ensureObjectExists, uploadFile } from './storage.mjs';
import { parseTemplateMesh, sortTemplateMeshes } from './template-mesh.mjs';

const EXPORT_PROFILES = [
	{
		key: 'light',
		koLabel: '가벼움',
		enLabel: 'Light',
		qualityKey: 'light',
		textureSize: 1024,
		includesAnimation: false
	},
	{
		key: 'medium',
		koLabel: '보통',
		enLabel: 'Medium',
		qualityKey: 'medium',
		textureSize: 2048,
		includesAnimation: false
	},
	{
		key: 'heavy',
		koLabel: '무거움',
		enLabel: 'Heavy',
		qualityKey: 'heavy',
		textureSize: 4096,
		includesAnimation: false
	},
	{
		key: 'light-animated',
		koLabel: '가벼움 + 애니메이션',
		enLabel: 'Light + Animation',
		qualityKey: 'light',
		textureSize: 1024,
		includesAnimation: true
	},
	{
		key: 'medium-animated',
		koLabel: '보통 + 애니메이션',
		enLabel: 'Medium + Animation',
		qualityKey: 'medium',
		textureSize: 2048,
		includesAnimation: true
	},
	{
		key: 'heavy-animated',
		koLabel: '무거움 + 애니메이션',
		enLabel: 'Heavy + Animation',
		qualityKey: 'heavy',
		textureSize: 4096,
		includesAnimation: true
	}
];

const ROLE_PATTERNS = [
	{ role: 'model', pattern: /\.gltf$/i },
	{ role: 'base_color', pattern: /(basecolor|base_color|albedo|diffuse)/i },
	{ role: 'normal', pattern: /normal/i },
	{ role: 'roughness', pattern: /roughness/i },
	{ role: 'guide', pattern: /guide/i }
];

function resolveBlenderBinary() {
	return process.env.TEMPLATE_WORKER_BLENDER_BIN?.trim() || 'blender';
}

function resolveGltfTransformBinary() {
	return process.env.TEMPLATE_WORKER_GLTF_TRANSFORM_BIN?.trim() || 'gltf-transform';
}

function guessMimeType(filePath) {
	const lower = filePath.toLowerCase();
	if (lower.endsWith('.gltf')) return 'model/gltf+json';
	if (lower.endsWith('.bin')) return 'application/octet-stream';
	if (lower.endsWith('.ktx2')) return 'image/ktx2';
	if (lower.endsWith('.png')) return 'image/png';
	if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
	if (lower.endsWith('.webp')) return 'image/webp';
	return 'application/octet-stream';
}

function guessRole(filePath) {
	for (const matcher of ROLE_PATTERNS) {
		if (matcher.pattern.test(filePath)) return matcher.role;
	}
	return 'extra';
}

function createRemoteAssetKey(templateId, assetSetKey, relativeFilePath) {
	return [
		'templates',
		templateId,
		'asset-sets',
		assetSetKey,
		relativeFilePath.replace(/^\/+/, '').replace(/\\/g, '/')
	].join('/');
}

function spawnCommand(command, args, options = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			stdio: 'pipe',
			...options
		});

		let stdout = '';
		let stderr = '';
		child.stdout?.on('data', (chunk) => {
			stdout += String(chunk);
		});
		child.stderr?.on('data', (chunk) => {
			stderr += String(chunk);
		});
		child.on('error', reject);
		child.on('close', (code) => {
			if (code === 0) {
				resolve({ stdout, stderr });
				return;
			}

			const stdoutText = stdout.trim();
			const stderrText = stderr.trim();
			const outputSections = [];
			if (stdoutText) {
				outputSections.push(`stdout:\n${stdoutText}`);
			}
			if (stderrText) {
				outputSections.push(`stderr:\n${stderrText}`);
			}

			reject(
				new Error(
					`${command} ${args.join(' ')} failed with exit code ${code}.${outputSections.length ? `\n\n${outputSections.join('\n\n')}` : ''}`
				)
			);
		});
	});
}

async function runBlenderScript(mode, blendPath, outputDir, textureSize, includesAnimation) {
	const blenderBinary = resolveBlenderBinary();
	const scriptPath = fileURLToPath(new URL('./blender/export-template.py', import.meta.url));

	const args = [
		'-b',
		blendPath,
		'-P',
		scriptPath,
		'--',
		'--mode',
		mode,
		'--output-dir',
		outputDir
	];

	if (Number.isFinite(textureSize)) {
		args.push('--texture-size', String(textureSize));
	}

	if (typeof includesAnimation === 'boolean') {
		args.push('--includes-animation', includesAnimation ? 'true' : 'false');
	}

	return await spawnCommand(blenderBinary, args);
}

async function runGltfTransformResize(inputPath, outputPath, textureSize) {
	const binary = resolveGltfTransformBinary();
	await spawnCommand(binary, [
		'resize',
		inputPath,
		outputPath,
		'--width',
		String(textureSize),
		'--height',
		String(textureSize)
	]);
}

async function runGltfTransformKtx2(inputPath, outputPath) {
	const binary = resolveGltfTransformBinary();
	await spawnCommand(binary, [
		'uastc',
		inputPath,
		outputPath,
		'--slots',
		'{baseColorTexture,normalTexture,occlusionTexture,metallicRoughnessTexture,emissiveTexture}',
		'--level',
		'4',
		'--rdo',
		'--rdo-lambda',
		'4',
		'--zstd',
		'18'
	]);
}

async function collectFilesRecursively(rootDir, currentDir = rootDir) {
	const entries = await readdir(currentDir, { withFileTypes: true });
	const files = [];

	for (const entry of entries) {
		const absolutePath = path.join(currentDir, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await collectFilesRecursively(rootDir, absolutePath)));
			continue;
		}

		files.push({
			absolutePath,
			relativePath: path.relative(rootDir, absolutePath).replace(/\\/g, '/')
		});
	}

	return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function uploadAssetDirectory(templateId, assetSetKey, directory) {
	const files = await collectFilesRecursively(directory);
	const uploaded = [];

	for (const [index, file] of files.entries()) {
		const remoteKey = createRemoteAssetKey(templateId, assetSetKey, file.relativePath);
		const result = await uploadFile(file.absolutePath, remoteKey, guessMimeType(file.relativePath));

		uploaded.push({
			role: guessRole(file.relativePath),
			storageKey: result.url,
			mimeType: guessMimeType(file.relativePath),
			sortOrder: index
		});
	}

	return uploaded;
}

function normalizeAvailableTextureSizes(maxTextureSize) {
	const baseSizes = [1024, 2048];
	if (Number(maxTextureSize) >= 4096) {
		baseSizes.push(4096);
	}
	return baseSizes;
}

function normalizeEditorMeshes(rawMeshes) {
	return sortTemplateMeshes(
		(rawMeshes ?? []).map((mesh) => {
			const parsed = parseTemplateMesh(mesh.meshKey);
			return {
				...parsed,
				displayLabel: mesh.displayLabel ?? parsed.displayLabel,
				sortOrder: mesh.sortOrder ?? parsed.sortOrder
			};
		})
	);
}

async function assertBlendFileHeader(blendPath) {
	const fileBuffer = await readFile(blendPath);
	const fileSize = fileBuffer.byteLength;
	const asciiHeader = fileBuffer.subarray(0, 16).toString('ascii');

	if (asciiHeader.startsWith('BLENDER')) {
		return;
	}

	const safeAsciiPreview = asciiHeader.replace(/[^\x20-\x7E]/g, '.');
	const hexPreview = fileBuffer
		.subarray(0, 16)
		.toString('hex')
		.match(/.{1,2}/g)
		?.join(' ') ?? '';

	throw new Error(
		`Downloaded source is not a valid .blend file. size=${fileSize} bytes, ascii="${safeAsciiPreview}", hex="${hexPreview}"`
	);
}

export async function processTemplateUpload({ templateId, sourceBlendStorageKey }) {
	await ensureObjectExists(sourceBlendStorageKey);

	const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'mws-template-worker-'));
	const blendPath = path.join(tempRoot, 'source.blend');
	const inspectDir = path.join(tempRoot, 'inspect');
	const inspectManifestPath = path.join(inspectDir, 'mesh-manifest.json');

	try {
		await downloadObjectToFile(sourceBlendStorageKey, blendPath);
		await assertBlendFileHeader(blendPath);
		await mkdir(inspectDir, { recursive: true });
		await runBlenderScript('inspect', blendPath, inspectDir);

		const inspectManifest = JSON.parse(await readFile(inspectManifestPath, 'utf8'));
		const availableTextureSizes = normalizeAvailableTextureSizes(inspectManifest.maxTextureSize);
		const editorMeshes = normalizeEditorMeshes(inspectManifest.meshes);
		const assetSets = [];

		for (const profile of EXPORT_PROFILES.filter((item) =>
			availableTextureSizes.includes(item.textureSize)
		)) {
			const exportRoot = path.join(tempRoot, profile.key);
			const rawDir = path.join(exportRoot, 'raw');
			const resizedPath = path.join(exportRoot, 'resized.gltf');
			const finalDir = path.join(exportRoot, 'final');
			const rawModelPath = path.join(rawDir, 'model.gltf');
			const finalModelPath = path.join(finalDir, 'model.gltf');

			await mkdir(rawDir, { recursive: true });
			await mkdir(finalDir, { recursive: true });
			await runBlenderScript(
				'export',
				blendPath,
				rawDir,
				profile.textureSize,
				profile.includesAnimation
			);
			await runGltfTransformResize(rawModelPath, resizedPath, profile.textureSize);
			await runGltfTransformKtx2(resizedPath, finalModelPath);

			const files = await uploadAssetDirectory(templateId, profile.key, finalDir);
			assetSets.push({
				key: profile.key,
				koLabel: profile.koLabel,
				enLabel: profile.enLabel,
				qualityKey: profile.qualityKey,
				textureSize: profile.textureSize,
				includesAnimation: profile.includesAnimation,
				isDefault: profile.key === 'medium',
				files
			});
		}

		return {
			success: true,
			assetSets,
			editorMeshes
		};
	} finally {
		await rm(tempRoot, { recursive: true, force: true });
	}
}
