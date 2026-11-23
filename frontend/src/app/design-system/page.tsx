import type { Metadata } from 'next';
import { Plane } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/ui/card';
import { Checkbox } from '@/shared/ui/checkbox';
import { EmptyState } from '@/shared/ui/empty-state';
import { ErrorState } from '@/shared/ui/error-state';
import { FormField } from '@/shared/ui/form-field';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { PageHeader } from '@/shared/ui/page-header';
import { Pagination } from '@/shared/ui/pagination';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select';
import { Spinner } from '@/shared/ui/spinner';
import { StatusBadge, type BookingStatus } from '@/shared/ui/status-badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/ui/table';
import { Textarea } from '@/shared/ui/textarea';
import { InteractiveDemo } from './interactive-demo';

export const metadata: Metadata = {
  title: 'Design system',
  robots: { index: false },
};

const SWATCHES = [
  ['background', 'bg-background'],
  ['foreground', 'bg-foreground'],
  ['card', 'bg-card'],
  ['primary', 'bg-primary'],
  ['secondary', 'bg-secondary'],
  ['accent', 'bg-accent'],
  ['muted', 'bg-muted'],
  ['destructive', 'bg-destructive'],
  ['success', 'bg-success'],
  ['warning', 'bg-warning'],
  ['info', 'bg-info'],
  ['border', 'bg-border'],
] as const;

const VARIANTS = [
  'default',
  'secondary',
  'outline',
  'ghost',
  'destructive',
  'link',
] as const;
const SIZES = ['xs', 'sm', 'default', 'lg'] as const;
const STATUSES: BookingStatus[] = [
  'PENDING_PAYMENT',
  'CONFIRMED',
  'COMPLETED',
  'EXPIRED',
  'CANCELLED',
];
const BOOKINGS: {
  ref: string;
  route: string;
  status: BookingStatus;
  total: string;
}[] = [
  {
    ref: 'BK-1001',
    route: 'CAI to DXB',
    status: 'CONFIRMED',
    total: '$420.00',
  },
  {
    ref: 'BK-1002',
    route: 'DXB to LHR',
    status: 'PENDING_PAYMENT',
    total: '$615.50',
  },
  {
    ref: 'BK-1003',
    route: 'LHR to CAI',
    status: 'CANCELLED',
    total: '$380.00',
  },
];

function slug(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={`ds-${slug(title)}`} className="grid gap-4">
      <h2
        id={`ds-${slug(title)}`}
        className="border-b pb-2 text-xl font-semibold"
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Static showcase of the shared UI (GEN-17). Not indexed; reads no request data. */
export default function DesignSystemPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-12 px-4 py-10">
      <PageHeader
        title="Design system"
        description="Semantic tokens and shared components. Toggle your OS theme to check dark mode."
      />

      <Section title="Colours">
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {SWATCHES.map(([name, bg]) => (
            <li key={name} className="grid gap-1.5 text-sm">
              <span className={`h-12 rounded-lg border ${bg}`} />
              <span className="font-medium">{name}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Typography">
        <div className="grid gap-3">
          <p className="text-3xl font-semibold">Heading 1</p>
          <p className="text-2xl font-semibold">Heading 2</p>
          <p className="text-xl font-semibold">Heading 3</p>
          <p>Body text for paragraphs and general content.</p>
          <p className="text-muted-foreground">
            Muted text for secondary information.
          </p>
        </div>
      </Section>

      <Section title="Buttons">
        <div className="grid gap-3">
          {VARIANTS.map((variant) => (
            <div key={variant} className="flex flex-wrap items-center gap-3">
              <span className="w-24 text-sm text-muted-foreground">
                {variant}
              </span>
              {SIZES.map((size) => (
                <Button key={size} variant={variant} size={size}>
                  {size}
                </Button>
              ))}
              <Button variant={variant} disabled>
                disabled
              </Button>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Form controls">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label="Full name"
            hint="As it appears on your passport"
            required
          >
            {(control) => <Input placeholder="Jane Doe" {...control} />}
          </FormField>
          <FormField label="Email" error="Enter a valid email address" required>
            {(control) => (
              <Input type="email" defaultValue="not-an-email" {...control} />
            )}
          </FormField>
          <FormField label="Cabin class">
            {({ id, ...control }) => (
              <Select defaultValue="economy">
                <SelectTrigger id={id} className="w-full" {...control}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="economy">Economy</SelectItem>
                  <SelectItem value="business">Business</SelectItem>
                </SelectContent>
              </Select>
            )}
          </FormField>
          <FormField label="Notes">
            {(control) => <Textarea rows={3} {...control} />}
          </FormField>
          <div className="flex items-center gap-2">
            <Checkbox id="ds-terms" />
            <Label htmlFor="ds-terms">I agree to the terms</Label>
          </div>
        </div>
      </Section>

      <Section title="Card">
        <Card>
          <CardHeader>
            <CardTitle>Cairo to Dubai</CardTitle>
            <CardDescription>Direct flight, 4h 10m</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <span className="text-muted-foreground">From</span>
            <span className="text-lg font-semibold">$420.00</span>
          </CardContent>
        </Card>
      </Section>

      <Section title="Table">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Reference</TableHead>
              <TableHead>Route</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {BOOKINGS.map((b) => (
              <TableRow key={b.ref}>
                <TableCell className="font-medium">{b.ref}</TableCell>
                <TableCell>{b.route}</TableCell>
                <TableCell>
                  <StatusBadge status={b.status} />
                </TableCell>
                <TableCell className="text-right">{b.total}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      <Section title="Status badges">
        <div className="flex flex-wrap gap-2">
          {STATUSES.map((status) => (
            <StatusBadge key={status} status={status} />
          ))}
        </div>
      </Section>

      <Section title="States">
        <div className="grid gap-4 md:grid-cols-2">
          <EmptyState
            icon={Plane}
            title="No trips yet"
            description="Search for a flight to start planning."
            action={<Button>Search flights</Button>}
          />
          <ErrorState message="We could not load your bookings. Please try again later." />
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Spinner />
          <span>Loading indicator</span>
        </div>
      </Section>

      <Section title="Pagination">
        <Pagination
          page={3}
          totalPages={8}
          hrefFor={(page) => `/design-system?page=${page}`}
        />
      </Section>

      <Section title="Confirm dialog and toasts">
        <InteractiveDemo />
      </Section>
    </main>
  );
}
