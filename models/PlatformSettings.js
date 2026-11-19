import mongoose from 'mongoose';

const platformSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, enum: ['platform'], unique: true, default: 'platform' },
    commissionBps: { type: Number, required: true, min: 0, max: 5000, default: 1000 },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

export default mongoose.models.PlatformSettings
  ?? mongoose.model('PlatformSettings', platformSettingsSchema);
