import cors from 'cors';
import express from 'express';
import { createId } from '@paralleldrive/cuid2';
import { processTemplateUpload } from './pipeline.mjs';

const app = express();
const port = Number(process.env.PORT || 3011);
const jobs = new Map();
let jobQueue = Promise.resolve();

function createJobResponse(job) {
	return {
		success: job.status === 'succeeded',
		jobId: job.id,
		status: job.status,
		error: job.error ?? null,
		details: job.details ?? null,
		assetSets: job.result?.assetSets ?? null,
		editorMeshes: job.result?.editorMeshes ?? null,
		createdAt: job.createdAt,
		updatedAt: job.updatedAt
	};
}

function updateJob(jobId, patch) {
	const current = jobs.get(jobId);
	if (!current) return null;
	const next = {
		...current,
		...patch,
		updatedAt: new Date().toISOString()
	};
	jobs.set(jobId, next);
	return next;
}

function scheduleTemplateUploadJob({ templateId, sourceBlendStorageKey }) {
	const job = {
		id: createId(),
		status: 'queued',
		templateId,
		sourceBlendStorageKey,
		result: null,
		error: null,
		details: null,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString()
	};

	jobs.set(job.id, job);

	jobQueue = jobQueue
		.catch(() => {})
		.then(async () => {
			updateJob(job.id, {
				status: 'running',
				error: null,
				details: null
			});

			try {
				const result = await processTemplateUpload({
					templateId,
					sourceBlendStorageKey
				});

				updateJob(job.id, {
					status: 'succeeded',
					result,
					error: null,
					details: null
				});
			} catch (error) {
				console.error('[template-worker] failed to process template upload');
				console.error(error);

				updateJob(job.id, {
					status: 'failed',
					result: null,
					error: 'Template export failed.',
					details: error instanceof Error ? error.message : 'Unknown worker error.'
				});
			}
		});

	return job;
}

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

	const job = scheduleTemplateUploadJob({
		templateId,
		sourceBlendStorageKey
	});

	response.status(202).json(createJobResponse(job));
});

app.get('/process-template-upload/:jobId', (request, response) => {
	const jobId = String(request.params?.jobId ?? '').trim();
	const job = jobs.get(jobId);

	if (!job) {
		response.status(404).json({
			success: false,
			error: 'Template upload job not found.'
		});
		return;
	}

	response.json(createJobResponse(job));
});

app.listen(port, () => {
	console.log(`[template-worker] listening on :${port}`);
});
