import mongoose from 'mongoose';

const orderItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', default: null },
    name: { type: String, required: true },
    vendorName: { type: String, required: true },
    size: { type: String, default: '' },
    color: { type: String, default: '' },
    unitPriceMinor: { type: Number, required: true },
    quantity: { type: Number, required: true, min: 1 },
    lineTotalMinor: { type: Number, required: true },
    commissionMinor: { type: Number, required: true },
    vendorEarningsMinor: { type: Number, required: true },
  },
  { _id: false },
);

const vendorFulfillmentSchema = new mongoose.Schema(
  {
    vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true },
    vendorName: { type: String, required: true },
    pickupAddressLine: { type: String, trim: true, maxlength: 240, default: '' },
    pickupCity: { type: String, trim: true, maxlength: 100, default: '' },
    pickupState: { type: String, trim: true, maxlength: 100, default: '' },
    status: {
      type: String,
      enum: ['new', 'accepted', 'preparing', 'ready_for_pickup', 'rejected'],
      default: 'new',
    },
    updatedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const statusEventSchema = new mongoose.Schema(
  {
    status: { type: String, required: true },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    note: { type: String, trim: true, maxlength: 240, default: '' },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const orderSchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    customerEmail: { type: String, required: true, lowercase: true },
    items: { type: [orderItemSchema], required: true, minlength: 1 },
    vendorFulfillments: { type: [vendorFulfillmentSchema], default: [] },
    subtotalMinor: { type: Number, required: true },
    commissionMinor: { type: Number, required: true },
    totalMinor: { type: Number, required: true },
    currency: { type: String, enum: ['NGN'], default: 'NGN' },
    deliveryAddress: {
      recipient: { type: String, required: true, maxlength: 120 },
      phone: { type: String, required: true, maxlength: 32 },
      addressLine: { type: String, required: true, maxlength: 240 },
      city: { type: String, required: true, maxlength: 100 },
      state: { type: String, required: true, maxlength: 100 },
    },
    status: {
      type: String,
      enum: [
        'pending_payment',
        'paid',
        'processing',
        'ready_for_pickup',
        'picked_up',
        'delivered',
        'cancelled',
      ],
      default: 'pending_payment',
      index: true,
    },
    deliveryPerson: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    deliveryAcceptedAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    refundStatus: {
      type: String,
      enum: ['not_required', 'required', 'refunded'],
      default: 'not_required',
      index: true,
    },
    refundReference: { type: String, trim: true, maxlength: 120, default: '' },
    statusHistory: { type: [statusEventSchema], default: [] },
    paidAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export default mongoose.models.Order ?? mongoose.model('Order', orderSchema);
