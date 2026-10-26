import TestCheckout from '@/components/TestCheckout';
export default async function CheckoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TestCheckout key={id} id={id} />;
}
