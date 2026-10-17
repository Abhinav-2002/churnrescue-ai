export const dynamic = 'force-dynamic';

import { DashboardClient } from '@/components/dashboard/DashboardClient';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Dashboard | ChurnRescue AI',
  description: 'Billing operations dashboard for ChurnRescue AI',
};

export default function DashboardPage() {
  return <DashboardClient />;
}
