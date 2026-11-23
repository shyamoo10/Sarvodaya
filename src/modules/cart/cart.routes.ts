import { Router } from 'express';
import { asyncHandler, sendSuccess } from '../../lib/http';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { idParamSchema } from '../users/user.schemas';
import {
  addCartItemSchema,
  cartQuerySchema,
  setDeliveryAddressSchema,
  updateCartItemSchema,
  type AddCartItemInput,
  type CartQuery,
  type SetDeliveryAddressInput,
  type UpdateCartItemInput,
} from './cart.schemas';
import {
  addCartItem,
  buildCartView,
  clearCart,
  removeCartItem,
  setDeliveryAddress,
  updateCartItem,
} from './cart.service';

export const cartRouter = Router();

cartRouter.use(requireAuth);

cartRouter.get(
  '/',
  validate(cartQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as CartQuery;
    const view = await buildCartView(req.authUser!, { addressId: query.addressId });
    sendSuccess(res, view, 200);
  }),
);

cartRouter.post(
  '/items',
  validate(addCartItemSchema),
  asyncHandler(async (req, res) => {
    const view = await addCartItem(req.authUser!, req.body as AddCartItemInput);
    sendSuccess(res, view, 201);
  }),
);

cartRouter.patch(
  '/items/:id',
  validate(idParamSchema, 'params'),
  validate(updateCartItemSchema),
  asyncHandler(async (req, res) => {
    const { quantity } = req.body as UpdateCartItemInput;
    const view = await updateCartItem(req.authUser!, req.params.id as string, quantity);
    sendSuccess(res, view, 200);
  }),
);

cartRouter.delete(
  '/items/:id',
  validate(idParamSchema, 'params'),
  asyncHandler(async (req, res) => {
    const view = await removeCartItem(req.authUser!, req.params.id as string);
    sendSuccess(res, view, 200);
  }),
);

cartRouter.delete(
  '/',
  asyncHandler(async (req, res) => {
    const view = await clearCart(req.authUser!);
    sendSuccess(res, view, 200);
  }),
);

cartRouter.put(
  '/delivery',
  validate(setDeliveryAddressSchema),
  asyncHandler(async (req, res) => {
    const { addressId } = req.body as SetDeliveryAddressInput;
    const view = await setDeliveryAddress(req.authUser!, addressId);
    sendSuccess(res, view, 200);
  }),
);
