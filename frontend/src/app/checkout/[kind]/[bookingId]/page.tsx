import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CheckoutFlow, isCheckoutKind } from '@/features/checkout';

export const metadata: Metadata = {
  title: 'Checkout',
  robots: { index: false },
};

/**
 * Pay page for a held booking: /checkout/flight/<id> or /checkout/hotel/<id>.
 * Rendering (brief section 9): dynamic per request behind the /checkout guard (USER only); the flow
 * itself is a Client Component because the hold timer and Stripe Elements run in the browser.
 */
export default async function CheckoutPayPage({
  params,
}: PageProps<'/checkout/[kind]/[bookingId]'>) {
  const { kind, bookingId } = await params;
  if (!isCheckoutKind(kind) || !/^[a-f0-9]{24}$/i.test(bookingId)) notFound();
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <CheckoutFlow kind={kind} bookingId={bookingId} />
    </main>
  );
}
