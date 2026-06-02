import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createWriteStream } from 'node:fs';

function normalizeEndpoint(value) {
	if (!value) return null;
	return value.endsWith('/') ? value.slice(0, -1) : value;
}

function buildPublicUrl(baseUrl, key) {
	return `${baseUrl.replace(/\/+$/, '')}/${key.replace(/^\/+/, '')}`;
}

function createStorageConfig() {
	const accessKeyId = process.env.S3_ACCESS_KEY || process.env.NCP_ACCESS_KEY;
	const secretAccessKey = process.env.S3_SECRET_KEY || process.env.NCP_SECRET_KEY;
	const region = process.env.S3_STORAGE_REGION || process.env.NCP_STORAGE_REGION || 'auto';
	const endpoint = normalizeEndpoint(
		process.env.S3_STORAGE_ENDPOINT || process.env.NCP_STORAGE_ENDPOINT
	);
	const bucket = process.env.S3_STORAGE_BUCKET || process.env.NCP_STORAGE_BUCKET;
	const publicBaseUrl = normalizeEndpoint(
		process.env.S3_PUBLIC_ENDPOINT || process.env.MWS_STORAGE_PUBLIC_ENDPOINT
	);

	if (!accessKeyId || !secretAccessKey || !endpoint || !bucket || !publicBaseUrl) {
		throw new Error(
			'Missing storage env. Set S3_ACCESS_KEY, S3_SECRET_KEY, S3_STORAGE_ENDPOINT, S3_STORAGE_BUCKET, and S3_PUBLIC_ENDPOINT.'
		);
	}

	return {
		region,
		endpoint,
		bucket,
		publicBaseUrl,
		client: new S3Client({
			region,
			endpoint,
			forcePathStyle: true,
			credentials: {
				accessKeyId,
				secretAccessKey
			}
		})
	};
}

function toNodeReadable(body) {
	if (!body) {
		throw new Error('Storage body is empty.');
	}

	if (body instanceof Readable) {
		return body;
	}

	if (typeof body.transformToWebStream === 'function') {
		return Readable.fromWeb(body.transformToWebStream());
	}

	if (typeof body.pipe === 'function') {
		return body;
	}

	throw new Error('Unsupported S3 response body type.');
}

async function streamToFile(readable, destination) {
	await mkdir(path.dirname(destination), { recursive: true });

	await new Promise((resolve, reject) => {
		const writer = createWriteStream(destination);
		readable.on('error', reject);
		writer.on('error', reject);
		writer.on('finish', resolve);
		readable.pipe(writer);
	});
}

export async function ensureObjectExists(key) {
	const storage = createStorageConfig();
	await storage.client.send(
		new HeadObjectCommand({
			Bucket: storage.bucket,
			Key: key
		})
	);
}

export async function downloadObjectToFile(key, destination) {
	const storage = createStorageConfig();
	const response = await storage.client.send(
		new GetObjectCommand({
			Bucket: storage.bucket,
			Key: key
		})
	);

	await streamToFile(toNodeReadable(response.Body), destination);
	return destination;
}

export async function uploadFile(localPath, remoteKey, contentType) {
	const storage = createStorageConfig();
	const body = await readFile(localPath);

	await storage.client.send(
		new PutObjectCommand({
			Bucket: storage.bucket,
			Key: remoteKey,
			Body: body,
			ContentType: contentType
		})
	);

	return {
		key: remoteKey,
		url: buildPublicUrl(storage.publicBaseUrl, remoteKey)
	};
}
