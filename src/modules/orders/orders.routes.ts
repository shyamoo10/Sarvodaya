import { Router } from 'express';
import { asyncHandler, sendSuccess } from '../../lib/http';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { idParamSchema } from '../users/user.schemas';
import { startOnlinePayment } from '../payments/payments.service';
import {
  cancelOrderSchema,
  checkoutSchema,
  orderListQuerySchema,
  type CancelOrderInput,
  type CheckoutInput,
  type OrderListQuery,
} from './order.schemas';
import { serializeOrder } from './order.serializer';
import { checkout, getOrderForUser, listOrders } from './orders.service';
import { cancelOrder, reorder } from './order.actions.service';
import { getInvoiceForOrder, renderInvoicePdf, serializeInvoice } from '../invoices/invoice.service';

export const ordersRouter = Router();

ordersRouter.use(requireAuth);

ordersRouter.get(
  '/',
  validate(orderListQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as OrderListQuery;
    const result = await listOrders(req.authUser!, query);
    sendSuccess(res, result.orders.map((order) => serializeOrder(order)), 200, {
      page: result.page,
      limit: result.limit,
      total: result.total,
      totalPages: Math.ceil(result.total / result.limit),
    });
  }),
);

/**
 * Checkout. Send an `Idempotency-Key` header so a double tap (or a retried
 * request) returns the same order instead of placing a second one.
 */
ordersRouter.post(
  '/',
  validate(checkoutSchema),
  asyncHandler(async (req, res) => {
    const key = req.header('idempotency-key') ?? undefined;
    const result = await checkout(req.authUser!, req.body as CheckoutInput, key);

    res.setHeader('Idempotent-Replayed', result.replayed ? 'true' : 'false');
    sendSuccess(res, serializeOrder(result.order), result.replayed ? 200 : 201);
  }),
);

ordersRouter.get(
  '/:id',
  validate(idParamSchema, 'params'),
  asyncHandler(async (req, res) => {
    const order = await getOrderForUser(req.authUser!, req.params.id as string);
    sendSuccess(res, serializeOrder(order), 200);
  }),
);

/** The invoice as a PDF, generated on demand from the order's frozen prices. */
ordersRouter.get(
  '/:id/invoice',
  validate(idParamSchema, 'params'),
  asyncHandler(async (req, res) => {
    const order = await getOrderForUser(req.authUser!, req.params.id as string);
    const pdf = await renderInvoicePdf(order.id);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${pdf.fileName}"`);
    res.setHeader('Content-Length', String(pdf.buffer.length));
    res.status(200).send(pdf.buffer);
  }),
);

/** The invoice record as JSON, for apps that show their own receipt screen. */
ordersRouter.get(
  '/:id/invoice/details',
  validate(idParamSchema, 'params'),
  asyncHandler(async (req, res) => {
    const order = await getOrderForUser(req.authUser!, req.params.id as string);
    const invoice = await getInvoiceForOrder(order.id);
    sendSuccess(res, serializeInvoice(invoice), 200);
  }),
);

ordersRouter.post(
  '/:id/cancel',
  validate(idParamSchema, 'params'),
  validate(cancelOrderSchema),
  asyncHandler(async (req, res) => {
    const order = await cancelOrder(
      req.authUser!,
      req.params.id as string,
      req.body as CancelOrderInput,
    );
    sendSuccess(res, serializeOrder(order), 200);
  }),
);

/** One tap reorder: puts the order's items back in the cart. */
ordersRouter.post(
  '/:id/reorder',
  validate(idParamSchema, 'params'),
  asyncHandler(async (req, res) => {
    const result = await reorder(req.authUser!, req.params.id as string);
    sendSuccess(res, result, 200);
  }),
);

ordersRouter.post(
  '/:id/payments/online',
  validate(idParamSchema, 'params'),
  asyncHandler(async (req, res) => {
    const intent = await startOnlinePayment(req.authUser!, req.params.id as string);
    sendSuccess(res, intent, 201);
  }),
);
