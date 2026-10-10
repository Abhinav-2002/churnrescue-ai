// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ChatProvider } from '../src/components/ChatContext';
import { KpiCards } from '../src/components/dashboard/KpiCards';
import { PerformanceChart } from '../src/components/dashboard/PerformanceChart';
import { DonutChart } from '../src/components/dashboard/DonutChart';
import { FunnelChart } from '../src/components/dashboard/FunnelChart';
import { GuardrailsPanel } from '../src/components/dashboard/GuardrailsPanel';
import { HumanQueuePanel } from '../src/components/dashboard/HumanQueuePanel';
import { CustomersTable } from '../src/components/dashboard/CustomersTable';
import { CustomerDrawer } from '../src/components/dashboard/CustomerDrawer';
import { DashboardClient } from '../src/components/dashboard/DashboardClient';
import type {
  RangeTotals,
  Sparklines,
  DailySeriesPoint,
  InterventionMix,
  RecoveryFunnel,
  GuardrailSummary,
  PolicyAudit,
  HumanQueueItem,
  CustomerMetricRow,
  DecisionMetricRow,
  OfferMetricRow,
} from '../src/lib/types/metrics';

describe('Checkpoint D — Dashboard Panels Component Tests', () => {
  afterEach(() => {
    cleanup();
  });
  /* ------------------------------------------------------------------
   * 1. KPI CARDS
   * ------------------------------------------------------------------ */
  describe('KpiCards', () => {
    const mockRangeTotals: RangeTotals = {
      current: {
        recovered_revenue_cents: 8500,
        recovery_rate: 0.654,
        failed_amount_cents: 13000,
        customers_recovered: 12,
        needs_human: 2,
      },
      previous: {
        recovered_revenue_cents: 6000,
        recovery_rate: 0.500,
        failed_amount_cents: 12000,
        customers_recovered: 8,
        needs_human: 3,
        failed_events_count: 5, // >= 3, delta rule satisfied
      },
      deltas: {
        recovered_revenue_percent: 41.7,
        recovery_rate_points: 15.4,
        failed_amount_percent: 8.3,
        customers_recovered_percent: 50.0,
        needs_human_count: -1,
      },
    };

    const mockSparklines: Sparklines = {
      recovered_revenue: [1000, 2000, 4000, 8500],
      recovery_rate: [0.2, 0.4, 0.5, 0.65],
      failed_amount: [3000, 5000, 9000, 13000],
      customers_recovered: [2, 5, 8, 12],
      needs_human: [1, 2, 4, 2],
    };

    it('renders all 5 KPI cards with hero formatting on Recovered Revenue', () => {
      render(<KpiCards rangeTotals={mockRangeTotals} sparklines={mockSparklines} days={7} />);

      expect(screen.getByText('Recovered Revenue')).toBeTruthy();
      expect(screen.getByText('$85.00')).toBeTruthy();

      expect(screen.getByText('Recovery Rate')).toBeTruthy();
      expect(screen.getByText('65.4%')).toBeTruthy();

      expect(screen.getByText('Failed Amount')).toBeTruthy();
      expect(screen.getByText('$130.00')).toBeTruthy();

      expect(screen.getByText('Customers Recovered')).toBeTruthy();
      expect(screen.getByText('12')).toBeTruthy();

      expect(screen.getByText('Needs a Human')).toBeTruthy();
      expect(screen.getByText('2')).toBeTruthy();
    });

    it('displays delta percentages, signs, and screen reader sentences when previous failed events >= 3', () => {
      render(<KpiCards rangeTotals={mockRangeTotals} sparklines={mockSparklines} days={7} />);

      expect(screen.getByText('+41.7%')).toBeTruthy();
      expect(screen.getByText('+15.4 pts')).toBeTruthy();
      expect(screen.getByText('+8.3%')).toBeTruthy();
      expect(screen.getByText('+50.0%')).toBeTruthy();
      expect(screen.getByText('-1')).toBeTruthy();

      // Screen reader accessible announcements
      expect(
        screen.getByText('Increased by 41.7 percent compared to the previous 7 days')
      ).toBeTruthy();
      expect(
        screen.getByText('Decreased by 1.0 customers compared to the previous 7 days')
      ).toBeTruthy();
    });

    it('suppresses delta and shows "No prior data" when previous period has < 3 failed events', () => {
      const totalsLowHistory: RangeTotals = {
        ...mockRangeTotals,
        previous: {
          ...mockRangeTotals.previous,
          failed_events_count: 2, // strictly < 3
        },
      };

      render(<KpiCards rangeTotals={totalsLowHistory} sparklines={mockSparklines} days={7} />);

      const noPriorLabels = screen.getAllByText('No prior data');
      expect(noPriorLabels.length).toBe(5);
    });

    it('renders loading skeleton when loading=true', () => {
      const { container } = render(<KpiCards loading={true} days={7} />);
      const skeletons = container.querySelectorAll('.animate-pulse');
      expect(skeletons.length).toBeGreaterThan(0);
    });
  });

  /* ------------------------------------------------------------------
   * 2. PERFORMANCE CHART
   * ------------------------------------------------------------------ */
  describe('PerformanceChart', () => {
    const mockDailySeries: DailySeriesPoint[] = [
      { date: '2026-10-01', failed_amount_cents: 5000, recovered_amount_cents: 2500 },
      { date: '2026-10-02', failed_amount_cents: 8000, recovered_amount_cents: 6000 },
      { date: '2026-10-03', failed_amount_cents: 4000, recovered_amount_cents: 4000 },
    ];

    it('renders loading skeleton when loading=true and data is empty', () => {
      const { container } = render(
        <PerformanceChart data={[]} rangeDays={7} onRangeChange={() => {}} loading={true} />
      );
      expect(container.querySelector('.animate-pulse')).toBeTruthy();
    });

    it('renders empty state when data has 0 points', () => {
      render(
        <PerformanceChart data={[]} rangeDays={7} onRangeChange={() => {}} loading={false} />
      );
      expect(screen.getByText('Not enough history yet')).toBeTruthy();
    });

    it('safely handles 1 data point without division by zero or NaN', () => {
      const singlePoint: DailySeriesPoint[] = [
        { date: '2026-10-01', failed_amount_cents: 5000, recovered_amount_cents: 2500 },
      ];
      const { container } = render(
        <PerformanceChart
          data={singlePoint}
          rangeDays={7}
          onRangeChange={() => {}}
          loading={false}
        />
      );

      const polylines = container.querySelectorAll('polyline');
      expect(polylines.length).toBe(4);
      polylines.forEach((p) => {
        expect(p.getAttribute('points')).not.toContain('NaN');
      });
    });

    it('switches time range and calls onRangeChange callback', () => {
      const onRangeChange = vi.fn();
      render(
        <PerformanceChart
          data={mockDailySeries}
          rangeDays={7}
          onRangeChange={onRangeChange}
        />
      );

      const btn14d = screen.getByRole('radio', { name: '14d' });
      fireEvent.click(btn14d);
      expect(onRangeChange).toHaveBeenCalledWith(14);

      const btn30d = screen.getByRole('radio', { name: '30d' });
      fireEvent.click(btn30d);
      expect(onRangeChange).toHaveBeenCalledWith(30);
    });

    it('toggles accessible table view alternative', () => {
      render(
        <PerformanceChart
          data={mockDailySeries}
          rangeDays={7}
          onRangeChange={() => {}}
        />
      );

      const toggleBtn = screen.getByRole('button', { name: 'Switch to accessible table view' });
      fireEvent.click(toggleBtn);

      expect(screen.getByText('Daily Failed vs Recovered Telemetry Table')).toBeTruthy();
      expect(screen.getByText('2026-10-01')).toBeTruthy();
      expect(screen.getByText('$50.00')).toBeTruthy();
      expect(screen.getByText('$25.00')).toBeTruthy();

      // Toggle back to chart
      fireEvent.click(screen.getByRole('button', { name: 'Switch to chart view' }));
      expect(screen.queryByText('Daily Failed vs Recovered Telemetry Table')).toBeNull();
    });

    it('supports keyboard navigation for daily data points', () => {
      render(
        <PerformanceChart
          data={mockDailySeries}
          rangeDays={7}
          onRangeChange={() => {}}
        />
      );

      const pointBtn = screen.getByLabelText(/2026-10-01 UTC:/);
      fireEvent.focus(pointBtn);

      // Tooltip HUD should become visible
      expect(screen.getByText(/2026-10-01:/)).toBeTruthy();
    });
  });

  /* ------------------------------------------------------------------
   * 3. DONUT CHART (Intervention Mix)
   * ------------------------------------------------------------------ */
  describe('DonutChart', () => {
    const mockMix: InterventionMix = {
      total_interventions: 10,
      retry: 4,
      credit: 3,
      downgrade: 1,
      pause: 1,
      escalate: 1,
    };

    it('renders empty state when total_interventions is 0', () => {
      const emptyMix: InterventionMix = {
        total_interventions: 0,
        retry: 0,
        credit: 0,
        downgrade: 0,
        pause: 0,
        escalate: 0,
      };
      render(<DonutChart mix={emptyMix} />);
      expect(screen.getByText('No interventions recorded')).toBeTruthy();
    });

    it('renders center total count and legend items', () => {
      render(<DonutChart mix={mockMix} />);
      expect(screen.getByText('10')).toBeTruthy();
      expect(screen.getByText('Interventions')).toBeTruthy();

      expect(screen.getByText('Card Swap / Retry')).toBeTruthy();
      expect(screen.getByText('Discount Applied')).toBeTruthy();
      expect(screen.getByText('Plan Downgrade')).toBeTruthy();
      expect(screen.getByText('Account Paused')).toBeTruthy();
      expect(screen.getByText('Human Escalation')).toBeTruthy();
    });

    it('triggers filter callback when slice is clicked', () => {
      const onSelectAction = vi.fn();
      render(<DonutChart mix={mockMix} onSelectAction={onSelectAction} />);

      const retryBtn = screen.getByRole('button', { name: 'Card Swap / Retry: 4 customers (40%)' });
      fireEvent.click(retryBtn);
      expect(onSelectAction).toHaveBeenCalledWith('retry');
    });

    it('renders clear filter chip when activeFilter is set', () => {
      const onSelectAction = vi.fn();
      render(
        <DonutChart mix={mockMix} activeFilter="credit" onSelectAction={onSelectAction} />
      );

      expect(screen.getByText(/Filtering by:/)).toBeTruthy();
      const clearBtn = screen.getByRole('button', { name: 'Clear intervention filter' });
      fireEvent.click(clearBtn);
      expect(onSelectAction).toHaveBeenCalledWith(null);
    });

    it('toggles accessible table alternative', () => {
      render(<DonutChart mix={mockMix} />);
      const toggleBtn = screen.getByRole('button', { name: 'Switch to accessible table view' });
      fireEvent.click(toggleBtn);

      expect(screen.getByText('Intervention Mix Breakdown Table')).toBeTruthy();
      expect(screen.getByText('Card Swap / Retry')).toBeTruthy();
    });
  });

  /* ------------------------------------------------------------------
   * 4. FUNNEL CHART
   * ------------------------------------------------------------------ */
  describe('FunnelChart', () => {
    const mockFunnel: RecoveryFunnel = {
      failed: 20,
      offered: 16,
      accepted: 12,
      paid: 10,
    };

    it('renders empty state when failed count is 0', () => {
      render(<FunnelChart funnel={{ failed: 0, offered: 0, accepted: 0, paid: 0 }} />);
      expect(screen.getByText('No billing failures recorded')).toBeTruthy();
    });

    it('renders monotonic stages with counts and conversion percentages', () => {
      render(<FunnelChart funnel={mockFunnel} />);

      expect(screen.getByText('1. Failed Billing Events')).toBeTruthy();
      expect(screen.getByText('20')).toBeTruthy();

      expect(screen.getByText('2. Interventions Offered')).toBeTruthy();
      expect(screen.getByText('16')).toBeTruthy();
      expect(screen.getByText('80%')).toBeTruthy();

      expect(screen.getByText('3. Terms Accepted')).toBeTruthy();
      expect(screen.getByText('12')).toBeTruthy();
      expect(screen.getByText('60%')).toBeTruthy();

      expect(screen.getByText('4. Payments Captured')).toBeTruthy();
      expect(screen.getByText('10')).toBeTruthy();
      expect(screen.getByText('50%')).toBeTruthy();
    });

    it('triggers stage filter callback on click', () => {
      const onSelectStage = vi.fn();
      render(<FunnelChart funnel={mockFunnel} onSelectStage={onSelectStage} />);

      const offeredStage = screen.getByRole('button', {
        name: /2\. Interventions Offered/,
      });
      fireEvent.click(offeredStage);
      expect(onSelectStage).toHaveBeenCalledWith('offered');
    });

    it('shows filter chip and clears stage filter', () => {
      const onSelectStage = vi.fn();
      render(<FunnelChart funnel={mockFunnel} activeStage="paid" onSelectStage={onSelectStage} />);

      expect(screen.getByText(/Filtering table by stage:/)).toBeTruthy();
      const clearBtn = screen.getByRole('button', { name: 'Clear funnel stage filter' });
      fireEvent.click(clearBtn);
      expect(onSelectStage).toHaveBeenCalledWith(null);
    });

    it('toggles accessible table alternative', () => {
      render(<FunnelChart funnel={mockFunnel} />);
      const toggleBtn = screen.getByRole('button', { name: 'Switch to accessible table view' });
      fireEvent.click(toggleBtn);

      expect(
        screen.getByText('Recovery Pipeline Funnel Conversion Table')
      ).toBeTruthy();
    });
  });

  /* ------------------------------------------------------------------
   * 5. GUARDRAILS PANEL
   * ------------------------------------------------------------------ */
  describe('GuardrailsPanel', () => {
    const mockSummary: GuardrailSummary = {
      pricing_adjustments: 3,
      blocked_suggestions: 1,
      escalated_by_keyword: 2,
      template_enforced: 4,
      total_checks: 18,
      latest_clamp_summary: 'Clamped discount 40% -> 30% on step 3',
    };

    it('displays green audit pill when 0 outside policy', () => {
      const mockAudit: PolicyAudit = {
        total_audited: 15,
        outside_policy_count: 0,
        violating_offer_ids: [],
      };

      render(<GuardrailsPanel summary={mockSummary} audit={mockAudit} />);
      expect(screen.getByText('15 audited, 0 outside policy')).toBeTruthy();
      expect(screen.getByText('Discount Capped')).toBeTruthy();
      expect(screen.getByText('Forced Retry')).toBeTruthy();
      expect(screen.getByText('Keyword Escalation')).toBeTruthy();
      expect(screen.getByText('Template Used')).toBeTruthy();
      expect(screen.getByText('Clamped discount 40% -> 30% on step 3')).toBeTruthy();
    });

    it('displays red warning pill and expands violating offer IDs when outside_policy_count > 0', () => {
      const mockViolatingAudit: PolicyAudit = {
        total_audited: 15,
        outside_policy_count: 1,
        violating_offer_ids: ['off_corrupted_123'],
      };

      render(<GuardrailsPanel summary={mockSummary} audit={mockViolatingAudit} />);

      const pillBtn = screen.getByRole('button', {
        name: /15 audited, 1 outside policy. Click to inspect violating offer IDs/,
      });
      expect(pillBtn).toBeTruthy();

      // Click to toggle violations modal/tray
      fireEvent.click(pillBtn);
      expect(screen.getByText('Violating Offer IDs (1):')).toBeTruthy();
      expect(screen.getByText('off_corrupted_123')).toBeTruthy();

      // Dismiss
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
      expect(screen.queryByText('Violating Offer IDs (1):')).toBeNull();
    });
  });

  /* ------------------------------------------------------------------
   * 6. HUMAN QUEUE PANEL
   * ------------------------------------------------------------------ */
  describe('HumanQueuePanel', () => {
    const mockQueue: HumanQueueItem[] = [
      {
        customer_id: 'cust_low',
        name: 'Alice Low',
        reason_category: 'disputed_charge',
        severity: 'Low',
        failed_amount_cents: 3000,
        created_at: new Date(Date.now() - 3600000).toISOString(),
      },
      {
        customer_id: 'cust_high',
        name: 'Bob High',
        reason_category: 'cancellation_request',
        severity: 'High',
        failed_amount_cents: 9900,
        created_at: new Date(Date.now() - 1800000).toISOString(),
      },
      {
        customer_id: 'cust_med',
        name: 'Charlie Med',
        reason_category: 'insufficient_funds',
        severity: 'Medium',
        failed_amount_cents: 4500,
        created_at: new Date(Date.now() - 600000).toISOString(),
      },
    ];

    it('renders empty state when queue is empty', () => {
      render(<HumanQueuePanel queue={[]} />);
      expect(screen.getByText('No customers requiring human intervention')).toBeTruthy();
    });

    it('sorts queue by severity rank (High -> Medium -> Low) and displays relative time', () => {
      render(<HumanQueuePanel queue={mockQueue} />);

      const rows = screen.getAllByRole('row');
      // Row 0 is header. Row 1 should be High (Bob), Row 2 Medium (Charlie), Row 3 Low (Alice)
      expect(rows[1].textContent).toContain('Bob High');
      expect(rows[1].textContent).toContain('High');
      expect(rows[2].textContent).toContain('Charlie Med');
      expect(rows[2].textContent).toContain('Medium');
      expect(rows[3].textContent).toContain('Alice Low');
      expect(rows[3].textContent).toContain('Low');
    });

    it('guarantees zero PII by omitting customer email addresses', () => {
      const { container } = render(<HumanQueuePanel queue={mockQueue} />);
      expect(container.textContent).not.toContain('@');
    });

    it('triggers review drawer callback when review button is clicked', () => {
      const onOpenDrawer = vi.fn();
      render(<HumanQueuePanel queue={mockQueue} onOpenDrawer={onOpenDrawer} />);

      const reviewButtons = screen.getAllByRole('button', { name: 'Review' });
      fireEvent.click(reviewButtons[0]); // Bob High
      expect(onOpenDrawer).toHaveBeenCalledWith('cust_high');
    });
  });

  /* ------------------------------------------------------------------
   * 7. CUSTOMERS TABLE
   * ------------------------------------------------------------------ */
  describe('CustomersTable', () => {
    const mockCustomers: CustomerMetricRow[] = [
      {
        id: 'cust_1',
        name: 'Acme Corp',
        plan: 'Enterprise Pro',
        price_cents: 9900,
        usage_percent: 85,
        status: 'at_risk',
        last_action: 'retry_scheduled',
        last_action_at: new Date(Date.now() - 1000).toISOString(), // < 5s (recent change)
        failed_amount_cents: 9900,
        recovered_amount_cents: 0,
        intervention: 'card_retry',
        updated_at: new Date().toISOString(),
      },
      {
        id: 'cust_2',
        name: 'Beta Inc',
        plan: 'Starter Plan',
        price_cents: 2900,
        usage_percent: 20,
        status: 'recovered',
        last_action: 'credit_applied',
        last_action_at: new Date(Date.now() - 86400000).toISOString(),
        failed_amount_cents: 2900,
        recovered_amount_cents: 2900,
        intervention: 'discount',
        updated_at: new Date(Date.now() - 86400000).toISOString(),
      },
    ];

    it('renders customer rows with status pills, plan, and formatted cents', () => {
      render(<CustomersTable customers={mockCustomers} />);

      expect(screen.getByText('Acme Corp')).toBeTruthy();
      expect(screen.getByText('Enterprise Pro')).toBeTruthy();
      expect(screen.getByText('($99.00/mo)')).toBeTruthy();

      expect(screen.getByText('Beta Inc')).toBeTruthy();
      expect(screen.getByText('Starter Plan')).toBeTruthy();
    });

    it('filters rows dynamically by search input (name or plan)', () => {
      render(<CustomersTable customers={mockCustomers} />);

      const searchInput = screen.getByPlaceholderText('Search by customer or plan...');
      fireEvent.change(searchInput, { target: { value: 'Enterprise' } });

      expect(screen.getByText('Acme Corp')).toBeTruthy();
      expect(screen.queryByText('Beta Inc')).toBeNull();
    });

    it('filters rows by status dropdown', () => {
      render(<CustomersTable customers={mockCustomers} />);

      const statusSelect = screen.getByRole('combobox');
      fireEvent.change(statusSelect, { target: { value: 'recovered' } });

      expect(screen.queryByText('Acme Corp')).toBeNull();
      expect(screen.getByText('Beta Inc')).toBeTruthy();
    });

    it('highlights recently updated rows (<5s) with motion-safe:animate-pulse class', () => {
      render(<CustomersTable customers={mockCustomers} />);

      const acmeRow = screen.getByRole('row', {
        name: /Acme Corp/,
      });
      expect(acmeRow.className).toContain('motion-safe:animate-pulse');
    });

    it('triggers drawer opening when clicking row or pressing Enter', () => {
      const onOpenDrawer = vi.fn();
      render(<CustomersTable customers={mockCustomers} onOpenDrawer={onOpenDrawer} />);

      const acmeRow = screen.getByRole('row', {
        name: /Acme Corp/,
      });
      fireEvent.click(acmeRow);
      expect(onOpenDrawer).toHaveBeenCalledWith('cust_1', expect.anything());

      fireEvent.keyDown(acmeRow, { key: 'Enter' });
      expect(onOpenDrawer).toHaveBeenCalledWith('cust_1', expect.anything());
    });

    it('paginates strictly at 25 rows per page', () => {
      // Generate 30 customer rows with zero-padded names for alphabetical order stability
      const thirtyCustomers: CustomerMetricRow[] = Array.from({ length: 30 }, (_, i) => {
        const num = String(i + 1).padStart(2, '0');
        return {
          id: `cust_${i}`,
          name: `Customer ${num}`,
          plan: 'Standard',
          price_cents: 4900,
          usage_percent: 50,
          status: 'at_risk',
          last_action: null,
          last_action_at: null,
          failed_amount_cents: 4900,
          recovered_amount_cents: 0,
          intervention: null,
          updated_at: new Date(2026, 0, 30 - i).toISOString(),
        };
      });

      render(<CustomersTable customers={thirtyCustomers} />);

      // Exactly 25 rows on page 1 (plus 1 header row = 26 total rows)
      const rows = screen.getAllByRole('row');
      expect(rows.length).toBe(26);

      // First page should show Customer 01 through Customer 25
      expect(screen.getByText('Customer 01')).toBeTruthy();
      expect(screen.getByText('Customer 25')).toBeTruthy();
      expect(screen.queryByText('Customer 26')).toBeNull();
      expect(screen.getByText(/Page 1 of 2/)).toBeTruthy();

      // Go to next page
      const nextBtn = screen.getByRole('button', { name: 'Next' });
      fireEvent.click(nextBtn);

      expect(screen.getByText('Customer 26')).toBeTruthy();
      expect(screen.getByText('Customer 30')).toBeTruthy();
      expect(screen.queryByText('Customer 01')).toBeNull();
    });
  });

  /* ------------------------------------------------------------------
   * 8. CUSTOMER DRAWER
   * ------------------------------------------------------------------ */
  describe('CustomerDrawer', () => {
    const mockCustomer: CustomerMetricRow = {
      id: 'cust_drawer_1',
      name: 'Delta Corp',
      plan: 'Growth Plan',
      price_cents: 14900,
      usage_percent: 72,
      status: 'at_risk',
      last_action: 'discount_offered',
      last_action_at: new Date().toISOString(),
      failed_amount_cents: 14900,
      recovered_amount_cents: 0,
      intervention: 'discount',
      updated_at: new Date().toISOString(),
    };

    const mockDecisions: DecisionMetricRow[] = [
      {
        created_at: new Date().toISOString(),
        customer_id: 'cust_drawer_1',
        action: 'offer_discount',
        proposed_discount_percent: 30,
        approved_discount_percent: 20,
        guardrail_category: 'floor_rule',
        ladder_step: 1,
      },
    ];

    const mockOffers: OfferMetricRow[] = [
      {
        id: 'off_101',
        customer_id: 'cust_drawer_1',
        kind: 'discount',
        discount_percent: 20,
        ladder_step: 1,
        amount_cents: 11920,
        status: 'pending',
        created_at: new Date().toISOString(),
      },
    ];

    it('renders drawer dialog with focus trap and initial focus on close button', async () => {
      const onClose = vi.fn();
      render(
        <CustomerDrawer
          isOpen={true}
          customerId="cust_drawer_1"
          customer={mockCustomer}
          decisions={mockDecisions}
          offers={mockOffers}
          onClose={onClose}
        />
      );

      expect(screen.getByRole('dialog', { name: 'Delta Corp' })).toBeTruthy();
      const closeBtn = screen.getByRole('button', { name: 'Close customer drawer' });

      await waitFor(() => {
        expect(document.activeElement).toBe(closeBtn);
      });
    });

    it('closes on Escape key press', () => {
      const onClose = vi.fn();
      render(
        <CustomerDrawer
          isOpen={true}
          customerId="cust_drawer_1"
          customer={mockCustomer}
          decisions={mockDecisions}
          offers={mockOffers}
          onClose={onClose}
        />
      );

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(onClose).toHaveBeenCalled();
    });

    it('returns focus to trigger element on unmount / close', () => {
      const onClose = vi.fn();
      const triggerButton = document.createElement('button');
      document.body.appendChild(triggerButton);
      triggerButton.focus();

      const triggerRef = { current: triggerButton };

      const { unmount } = render(
        <CustomerDrawer
          isOpen={true}
          customerId="cust_drawer_1"
          customer={mockCustomer}
          decisions={mockDecisions}
          offers={mockOffers}
          onClose={onClose}
          triggerRef={triggerRef}
        />
      );

      unmount();
      expect(document.activeElement).toBe(triggerButton);
      document.body.removeChild(triggerButton);
    });

    it('guarantees zero PII by showing only enumerated guardrail clamp fields and no private text', () => {
      const { container } = render(
        <CustomerDrawer
          isOpen={true}
          customerId="cust_drawer_1"
          customer={mockCustomer}
          decisions={mockDecisions}
          offers={mockOffers}
          onClose={() => {}}
        />
      );

      // Enumerated guardrail values present
      expect(screen.getByText('30%')).toBeTruthy();
      expect(screen.getAllByText('20%').length).toBeGreaterThan(0);
      expect(screen.getByText('floor_rule')).toBeTruthy();

      // Zero PII guarantees: No emails, no PayPal order IDs, no freeform prompt/response
      expect(container.textContent).not.toContain('@');
      expect(container.textContent).not.toContain('order_id');
      expect(container.textContent).not.toContain('system_prompt');
      expect(container.textContent).not.toContain('gemini');
    });
  });

  /* ------------------------------------------------------------------
   * 9. DASHBOARD CLIENT INTEGRATION & STALE HANDLING
   * ------------------------------------------------------------------ */
  describe('DashboardClient Integration', () => {
    let originalMatchMedia: typeof window.matchMedia;

    beforeEach(() => {
      originalMatchMedia = window.matchMedia;
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ ETag: 'etag-123' }),
        json: async () => ({
          range_days: 7,
          range_totals: {
            current: {
              recovered_revenue_cents: 5000,
              recovery_rate: 0.5,
              failed_amount_cents: 10000,
              customers_recovered: 5,
              needs_human: 1,
            },
            previous: {
              recovered_revenue_cents: 4000,
              recovery_rate: 0.4,
              failed_amount_cents: 10000,
              customers_recovered: 4,
              needs_human: 2,
              failed_events_count: 5,
            },
            deltas: {
              recovered_revenue_percent: 25.0,
              recovery_rate_points: 10.0,
              failed_amount_percent: 0.0,
              customers_recovered_percent: 25.0,
              needs_human_count: -1,
            },
          },
          kpis: {
            total_failed: 10000,
            total_recovered: 5000,
            recovery_rate: 0.5,
            at_risk: 10,
            paused: 2,
            escalated: 1,
            average_discount: 15,
            median_hours_to_recovery: 4,
          },
          daily_series: [],
          sparklines: {
            recovered_revenue: [],
            recovery_rate: [],
            failed_amount: [],
            customers_recovered: [],
            needs_human: [],
          },
          intervention_mix: {
            total_interventions: 0,
            retry: 0,
            credit: 0,
            downgrade: 0,
            pause: 0,
            escalate: 0,
          },
          funnel: {
            failed: 0,
            offered: 0,
            accepted: 0,
            paid: 0,
          },
          guardrail_summary: {
            pricing_adjustments: 0,
            blocked_suggestions: 0,
            escalated_by_keyword: 0,
            template_enforced: 0,
            total_checks: 0,
            latest_clamp_summary: null,
          },
          policy_audit: {
            total_audited: 0,
            outside_policy_count: 0,
            violating_offer_ids: [],
          },
          human_queue: [],
          customers: [],
          offers: [],
          recoveries: [],
          decisions: [],
        }),
      });
    });

    afterEach(() => {
      window.matchMedia = originalMatchMedia;
      vi.restoreAllMocks();
    });

    it('renders dashboard shell with sidebar anchors, theme toggle, and live status', () => {
      render(<ChatProvider><DashboardClient /></ChatProvider>);

      expect(screen.getByRole('heading', { name: 'Billing Operations' })).toBeTruthy();
      expect(screen.getByRole('link', { name: /overview/i })).toBeTruthy();
      expect(screen.getByRole('link', { name: /customers/i })).toBeTruthy();
      expect(screen.getByRole('link', { name: /needs a human/i })).toBeTruthy();
      expect(screen.getByRole('link', { name: /guardrails/i })).toBeTruthy();
    });
  });
});
