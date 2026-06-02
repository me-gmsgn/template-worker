function sanitizeMeshLabel(value) {
	return value
		.replace(/^\s*-?\d+\s*/, '')
		.replace(/\{[^}]*\}/g, ' ')
		.replace(/editable|drawable|texture|color/gi, ' ')
		.replace(/[_-]+/g, ' ')
		.replace(/[^\p{L}\p{N}\s]/gu, ' ')
		.trim()
		.replace(/\s+/g, ' ')
		.replace(/\b\w/g, (char) => char.toUpperCase()) || 'Mesh';
}

function extractSortOrder(value) {
	const match = value.match(/^\s*(-?\d+)/);
	if (!match) return Number.MAX_SAFE_INTEGER;
	return Number.parseInt(match[1], 10);
}

function extractColorBindingKey(value) {
	const matches = [...value.matchAll(/\{([^}]+)\}/g)];
	for (const match of matches) {
		const token = match[1]?.trim() ?? '';
		if (!token.toLowerCase().startsWith('color')) continue;
		return token;
	}
	return null;
}

function extractTextureBindingKey(value) {
	const matches = [...value.matchAll(/\{([^}]+)\}/g)];
	for (const match of matches) {
		const token = match[1]?.trim() ?? '';
		if (!token.toLowerCase().startsWith('texture')) continue;
		return token;
	}
	return null;
}

export function parseTemplateMesh(meshKey) {
	const lower = meshKey.toLowerCase();
	const isDrawable = lower.includes('drawable');
	const isEditable = lower.includes('editable') || isDrawable;
	const colorBindingKey = extractColorBindingKey(meshKey);
	const textureBindingKey = extractTextureBindingKey(meshKey);

	return {
		meshKey,
		displayLabel: sanitizeMeshLabel(meshKey),
		sortOrder: extractSortOrder(meshKey),
		isDrawable,
		isEditable,
		tintMode: colorBindingKey
			? isDrawable
				? 'overlay_shader'
				: 'material_base_color'
			: 'none',
		colorBindingKey,
		materialSlotKey: textureBindingKey
	};
}

export function sortTemplateMeshes(meshes) {
	return [...meshes].sort((left, right) => {
		const leftOrder = Number.isFinite(left.sortOrder)
			? Number(left.sortOrder)
			: extractSortOrder(left.meshKey);
		const rightOrder = Number.isFinite(right.sortOrder)
			? Number(right.sortOrder)
			: extractSortOrder(right.meshKey);

		if (leftOrder !== rightOrder) return leftOrder - rightOrder;
		return left.meshKey.localeCompare(right.meshKey);
	});
}
