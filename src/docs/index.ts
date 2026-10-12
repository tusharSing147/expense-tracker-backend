import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { openapiDocument } from './openapi';

const docsRouter = Router();

docsRouter.get('/openapi.json', (_req, res) => {
  res.status(200).json(openapiDocument);
});

docsRouter.use(swaggerUi.serve);

docsRouter.get(
  '/',
  swaggerUi.setup(openapiDocument, {
    swaggerOptions: { persistAuthorization: true },
  }),
);

export default docsRouter;
