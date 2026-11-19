import mongoose from 'mongoose';

const vendorSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    shopName: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, required: true, trim: true, maxlength: 1000 },
    contactPhone: { type: String, required: true, trim: true, maxlength: 32 },
    pickupAddressLine: { type: String, trim: true, maxlength: 240, default: '' },
    pickupCity: { type: String, trim: true, maxlength: 100, default: '' },
    pickupState: { type: String, trim: true, maxlength: 100, default: '' },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'approved',
      index: true,
    },
    reviewedAt: { type: Date, default: null },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    rejectionReason: { type: String, trim: true, maxlength: 300, default: '' },
    payoutTotalMinor: { type: Number, min: 0, default: 0 },
  },
  { timestamps: true },
);

export default mongoose.models.Vendor ?? mongoose.model('Vendor', vendorSchema);
