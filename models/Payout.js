import mongoose from 'mongoose';

const payoutSchema = new mongoose.Schema(
  {
    vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true, index: true },
    amountMinor: { type: Number, required: true, min: 1 },
    reference: { type: String, required: true, unique: true, trim: true, maxlength: 120 },
    note: { type: String, trim: true, maxlength: 300, default: '' },
    processedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    paidAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

export default mongoose.models.Payout ?? mongoose.model('Payout', payoutSchema);
