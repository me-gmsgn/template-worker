import cors from 'cors';
import express from 'express';
import { processTemplateUpload } from './pipeline.mjs';

const app = express();
const port = Number(process.env.PORT || 3011);

app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_request, response) => {
	response.json({
		ok: true,
		service: 'template-worker',
		port
	});
});

app.post('/process-template-upload', async (request, response) => {
	const templateId = String(request.body?.templateId ?? '').trim();
	const sourceBlendStorageKey = String(request.body?.sourceBlendStorageKey ?? '').trim();

	if (!templateId || !sourceBlendStorageKey) {
		response.status(400).json({
			success: false,
			error: 'templateId and sourceBlendStorageKey are required.'
		});
		return;
	}

	try {
		const payload = await processTemplateUpload({
			templateId,
			sourceBlendStorageKey
		});

		response.json(payload);
	} catch (error) {
		console.error('[template-worker] failed to process template upload');
		console.error(error);

		response.status(500).json({
			success: false,
			error: 'Template export failed.',
			details: error instanceof Error ? error.message : 'Unknown worker error.'
		});
	}
});

app.listen(port, () => {
	console.log(`[template-worker] listening on :${port}`);
});
