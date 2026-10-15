import type { FastifyPluginAsync } from 'fastify';
import {
  type IOrderSummaryRepository,
  MongoOrderSummaryRepository,
  getMongoDatabase,
} from '@chronoscope/read-store';

export interface QueryRouteOptions {
  orderSummaryRepository?: IOrderSummaryRepository | undefined;
}

export const queryRoutes: FastifyPluginAsync<QueryRouteOptions> = async (app, opts) => {
  const orderRepo: IOrderSummaryRepository =
    opts.orderSummaryRepository ?? new MongoOrderSummaryRepository(getMongoDatabase());

  app.get('/api/v1/orders/:timelineId/:aggregateId', async (req, reply) => {
    const { timelineId, aggregateId } = req.params as {
      timelineId: string;
      aggregateId: string;
    };

    const doc = await orderRepo.findById(timelineId, aggregateId);
    if (!doc) {
      return reply.status(404).send({
        error: 'NOT_FOUND',
        message: `Order summary document '${timelineId}:${aggregateId}' not found in MongoDB read store`,
      });
    }

    return reply.status(200).send(doc);
  });

  app.get('/api/v1/orders/:timelineId', async (req, reply) => {
    const { timelineId } = req.params as { timelineId: string };
    const docs = await orderRepo.findByTimeline(timelineId);
    return reply.status(200).send(docs);
  });
};
