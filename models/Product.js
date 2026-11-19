import mongoose from 'mongoose';

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, required: true, trim: true, maxlength: 4000 },
    category: { type: String, required: true, trim: true, lowercase: true, maxlength: 80 },
    brand: { type: String, trim: true, maxlength: 120, default: '' },
    vendorName: { type: String, required: true, trim: true, maxlength: 120 },
    vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', default: null, index: true },
    priceMinor: { type: Number, required: true, min: 1 },
    currency: { type: String, enum: ['NGN'], default: 'NGN' },
    sizes: { type: [String], default: [] },
    colors: { type: [String], default: [] },
    imageUrls: { type: [String], default: [] },
    stock: { type: Number, required: true, min: 0, default: 0 },
    ratingAverage: { type: Number, min: 0, max: 5, default: 0 },
    ratingCount: { type: Number, min: 0, default: 0 },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);

productSchema.index({ name: 'text', description: 'text', category: 'text' });

export default mongoose.models.Product ?? mongoose.model('Product', productSchema);
