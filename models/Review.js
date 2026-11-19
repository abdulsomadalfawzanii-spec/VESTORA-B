import mongoose from 'mongoose';

const reviewSchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', default: null, index: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, trim: true, maxlength: 1200, default: '' },
  },
  { timestamps: true },
);

reviewSchema.index({ customer: 1, order: 1, product: 1 }, { unique: true });

export default mongoose.models.Review ?? mongoose.model('Review', reviewSchema);
