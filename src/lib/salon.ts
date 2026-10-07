// Muse is a placeholder brand; replace it with the real salon name before launch.
// Display prices as INR only; stored amounts and the booking timezone are unchanged.
export const salon = {
  name: "Muse",
  locale: "en-IN",
  currency: "INR",
};

export function formatPrice(price: number): string {
  return new Intl.NumberFormat(salon.locale, {
    style: "currency",
    currency: salon.currency,
    minimumFractionDigits: Number.isInteger(price) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(price);
}

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return `${minutes} min`;
  return `${hours} hr${remainder ? ` ${remainder} min` : ""}`;
}
