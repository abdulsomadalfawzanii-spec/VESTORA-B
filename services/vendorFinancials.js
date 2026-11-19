import mongoose from 'mongoose';
import Order from '../models/Order.js';

export async function getVendorFinancialSummary(vendorId) {
  const [summary] = await Order.aggregate([
    { $match: { 'vendorFulfillments.vendor': new mongoose.Types.ObjectId(vendorId) } },
    { $unwind: '$items' },
    { $match: { 'items.vendor': new mongoose.Types.ObjectId(vendorId) } },
    {
      $group: {
        _id: '$_id',
        status: { $first: '$status' },
        salesMinor: {
          $sum: {
            $cond: [{ $eq: ['$status', 'cancelled'] }, 0, '$items.lineTotalMinor'],
          },
        },
        earningsMinor: {
          $sum: {
            $cond: [{ $eq: ['$status', 'delivered'] }, '$items.vendorEarningsMinor', 0],
          },
        },
      },
    },
    {
      $group: {
        _id: null,
        orderCount: { $sum: 1 },
        openOrderCount: {
          $sum: {
            $cond: [{ $in: ['$status', ['delivered', 'cancelled']] }, 0, 1],
          },
        },
        completedOrderCount: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } },
        salesMinor: { $sum: '$salesMinor' },
        earningsMinor: { $sum: '$earningsMinor' },
      },
    },
  ]);
  return summary ?? {
    orderCount: 0,
    openOrderCount: 0,
    completedOrderCount: 0,
    salesMinor: 0,
    earningsMinor: 0,
  };
}
