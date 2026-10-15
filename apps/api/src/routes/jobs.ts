import type { FastifyPluginAsync } from 'fastify';
import {
  createJobRequestSchema,
  jobListQuerySchema,
  type CreateJobRequest,
  type JobListQuery,
} from '@chronoscope/contracts';
import type { IJobManager } from '@chronoscope/database';

export interface JobRoutesOptions {
  readonly jobManager?: IJobManager | undefined;
}

export const jobRoutes: FastifyPluginAsync<JobRoutesOptions> = async (app, options) => {
  const jobManager = options.jobManager;

  // POST /api/v1/jobs — Submit asynchronous background job (Rules 8 & 10, ADR-005)
  app.post<{ Body: CreateJobRequest }>('/api/v1/jobs', async (req, reply) => {
    if (!jobManager) {
      return reply.status(503).send({
        statusCode: 503,
        error: 'Service Unavailable',
        message: 'JobManager is not configured',
      });
    }

    const parseResult = createJobRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Validation failed',
        issues: parseResult.error.issues,
      });
    }

    try {
      const outcome = await jobManager.createJob(parseResult.data);
      const status = outcome.isNew ? 201 : 200;
      return reply.status(status).send({
        job: outcome.job,
        isNew: outcome.isNew,
      });
    } catch (err) {
      const error = err as Error;
      req.log.error(error, 'Error creating background job');
      return reply.status(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        message: error.message,
      });
    }
  });

  // GET /api/v1/jobs/:jobId — Get job status and result reference
  app.get<{ Params: { jobId: string } }>('/api/v1/jobs/:jobId', async (req, reply) => {
    if (!jobManager) {
      return reply.status(503).send({
        statusCode: 503,
        error: 'Service Unavailable',
        message: 'JobManager is not configured',
      });
    }

    const job = await jobManager.getJobById(req.params.jobId);
    if (!job) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: `Job ${req.params.jobId} not found`,
      });
    }

    return reply.status(200).send(job);
  });

  // GET /api/v1/jobs — List recent jobs
  app.get<{ Querystring: JobListQuery }>('/api/v1/jobs', async (req, reply) => {
    if (!jobManager) {
      return reply.status(503).send({
        statusCode: 503,
        error: 'Service Unavailable',
        message: 'JobManager is not configured',
      });
    }

    const query = jobListQuerySchema.parse(req.query);
    const jobs = await jobManager.listJobs(query.limit);
    return reply.status(200).send({ jobs });
  });
};
