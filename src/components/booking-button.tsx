import Link from "next/link";
import { ArrowIcon } from "@/components/icons";
import type { Service } from "@/types/database";

type BookingButtonProps = {
  service?: Service;
  preview?: boolean;
  className?: string;
};

export function BookingButton({ service, preview = false, className = "button-primary" }: BookingButtonProps) {
  // Preview IDs must never enter the real reservation flow as service IDs.
  const href = service && !preview
    ? { pathname: "/book", query: { service: service.id } }
    : "/book";

  return (
    <Link href={href} className={`button ${className}`} aria-label={service ? `Book Now — ${service.name}` : undefined}>
      Book Now
      <ArrowIcon className="h-[18px] w-[18px] shrink-0" />
    </Link>
  );
}
