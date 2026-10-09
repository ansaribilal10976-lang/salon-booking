import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import type { Service } from "@/types/database";

type BookingButtonProps = {
  service?: Service;
  preview?: boolean;
  className?: string;
  variant?: ButtonProps["variant"];
};

export function BookingButton({ service, preview = false, className, variant = "default" }: BookingButtonProps) {
  // Preview IDs must never enter the real reservation flow as service IDs.
  const href = service && !preview
    ? { pathname: "/book", query: { service: service.id } }
    : "/book";

  return (
    <Button asChild variant={variant} className={className}>
      <Link href={href} aria-label={service ? `Book Now — ${service.name}` : undefined}>
        Book Now
        <ArrowUpRight aria-hidden="true" />
      </Link>
    </Button>
  );
}
