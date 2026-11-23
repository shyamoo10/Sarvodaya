import { Router } from 'express';
import { asyncHandler, sendSuccess } from '../../lib/http';
import { requireAdmin, requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { idParamSchema } from '../users/user.schemas';
import {
  adminOrderListQuerySchema,
  cancelOrderSchema,
  recordPaymentSchema,
  updateOrderStatusSchema,
  waiveChargeSchema,
  type AdminOrderListQuery,
  type CancelOrderInput,
  type RecordPaymentInput,
  type UpdateOrderStatusInput,
  type WaiveChargeInput,
} from './order.schemas';
import { serializeOrder } from './order.serializer';
import { getOrderForUser, listOrders } from './orders.service';
import { cancelOrder, recordPayment, updateOrderStatus, waiveCharge } from './order.actions.service';

export const adminOrdersRouter = Router();

adminOrdersRouter.use(requireAuth, requireAdmin);

adminOrdersRouter.get(
  '/',
  validate(adminOrderListQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as AdminOrderListQuery;
    const result = await listOrders(req.authUser!, query);
    sendSuccess(
      res,
      result.orders.map((order) => serializeOrder(order, { includeAdmin: true })),
      200,
      {
        page: result.page,
        limit: result.limit,
        total: result.total,
        totalPages: Math.ceil(result.total / result.limit),
      },
    );
  }),
);

adminOrdersRouter.get(
  '/:id',
  validate(idParamSchema, 'params'),
  asyncHandler(async (req, res) => {
    const order = await getOrderForUser(req.authUser!, req.params.id as string);
    sendSuccess(res, serializeOrder(order, { includeAdmin: true }), 200);
  }),
);

/** The only way an order changes status. Every change is added to its history. */
adminOrdersRouter.patch(
  '/:id/status',
  validate(idParamSchema, 'params'),
  validate(updateOrderStatusSchema),
  asyncHandler(async (req, res) => {
    const order = await updateOrderStatus(
      req.authUser!,
      req.params.id as string,
      req.body as UpdateOrderStatusInput,
    );
    sendSuccess(res, serializeOrder(order, { includeAdmin: true }), 200);
  }),
);

adminOrdersRouter.post(
  '/:id/cancel',
  validate(idParamSchema, 'params'),
  validate(cancelOrderSchema),
  asyncHandler(async (req, res) => {
    const order = await cancelOrder(
      req.authUser!,
      req.params.id as string,
      req.body as CancelOrderInput,
    );
    sendSuccess(res, serializeOrder(order, { includeAdmin: true }), 200);
  }),
);

/** Waives the minimum order charge or the delivery charge on this one order. */
adminOrdersRouter.post(
  '/:id/waive-charge',
  validate(idParamSchema, 'params'),
  validate(waiveChargeSchema),
  asyncHandler(async (req, res) => {
    const order = await waiveCharge(
      req.authUser!,
      req.params.id as string,
      req.body as WaiveChargeInput,
    );
    sendSuccess(res, serializeOrder(order, { includeAdmin: true }), 200);
  }),
);

/** Records cash received, for example when a delivery is paid at the door. */
adminOrdersRouter.post(
  '/:id/payments',
  validate(idParamSchema, 'params'),
  validate(recordPaymentSchema),
  asyncHandler(async (req, res) => {
    const order = await recordPayment(
      req.authUser!,
      req.params.id as string,
      req.body as RecordPaymentInput,
    );
    sendSuccess(res, serializeOrder(order, { includeAdmin: true }), 201);
  }),
);
