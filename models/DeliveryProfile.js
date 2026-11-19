import mongoose from 'mongoose';

const deliveryProfileSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    phone: { type: String, required: true, trim: true, maxlength: 32 },
    vehicleType: { type: String, required: true, trim: true, maxlength: 60 },
    vehicleDescription: { type: String, trim: true, maxlength: 120, default: '' },
    licenseNumber: { type: String, trim: true, maxlength: 80, default: '' },
    verificationStatus: {
      type: String,
      enum: ['pending', 'verified', 'rejected'],
      default: 'pending',
      index: true,
    },
    isAvailable: { type: Boolean, default: false, index: true },
    reviewedAt: { type: Date, default: null },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

export default mongoose.models.DeliveryProfile
  ?? mongoose.model('DeliveryProfile', deliveryProfileSchema);
