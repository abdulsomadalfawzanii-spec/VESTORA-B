import mongoose from 'mongoose';

const paymentSchema = new mongoose.Schema(
  {
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
      unique: true,
    },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    reference: { type: String, required: true, unique: true, index: true },
    amountMinor: { type: Number, required: true, min: 1 },
    currency: { type: String, enum: ['NGN'], default: 'NGN' },
    status: {
      type: String,
      enum: ['initializing', 'initialized', 'success', 'failed'],
      default: 'initializing',
      index: true,
    },
    authorizationUrl: { type: String, default: '' },
    transactionId: { type: Number, default: null },
    channel: { type: String, default: '' },
    paidAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export default mongoose.models.Payment ?? mongoose.model('Payment', paymentSchema);
