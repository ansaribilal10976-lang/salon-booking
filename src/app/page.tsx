import Image from "next/image";
import { BookingButton } from "@/components/booking-button";
import { ArrowIcon, ClockIcon, FlowerIcon, LeafIcon, ScissorsIcon } from "@/components/icons";
import { formatDuration, formatPrice, salon } from "@/lib/salon";
import { loadServiceCatalog } from "@/lib/services";
import { createClient } from "@/lib/supabase/server";

// Read the current menu on each request, rather than freezing it at build time.
export const dynamic = "force-dynamic";

export default async function Home() {
  const catalog = await loadServiceCatalog(
    {
      url: process.env.NEXT_PUBLIC_SUPABASE_URL,
      key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    },
    async () => {
      const supabase = await createClient();
      return await supabase
        .from("services")
        .select("id, name, duration, price")
        .order("name")
        .abortSignal(AbortSignal.timeout(5000));
    },
  );

  return (
    <>
      <a href="#main" className="skip-link">Skip to content</a>
      <header id="home" className="page-width site-header grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-b border-line pb-2 pt-4 sm:flex sm:min-h-24 sm:justify-between sm:gap-6 sm:py-5">
        <a href="#home" aria-label={`${salon.name} home`} className="flex min-h-12 min-w-0 items-center gap-2 justify-self-start text-forest sm:shrink-0 sm:gap-2.5">
          <FlowerIcon className="h-8 w-8 sm:h-11 sm:w-11" />
          <span className="font-display text-[2rem] leading-none tracking-[-0.07em] sm:text-[2.6rem]">{salon.name.toLowerCase()}<span className="text-olive">.</span></span>
        </a>
        <nav aria-label="Main navigation" className="col-span-2 row-start-2 flex flex-wrap items-center gap-x-5 text-sm font-medium sm:ml-auto sm:gap-x-7">
          <a href="#services" className="nav-link">Services</a>
          <a href="#approach" className="nav-link">Your visit</a>
        </nav>
        <BookingButton className="button-primary button-small col-start-2 row-start-1" />
      </header>

      <main id="main" tabIndex={-1}>
        <section aria-labelledby="hero-title" className="page-width grid gap-9 pb-14 pt-8 sm:gap-14 sm:pb-24 sm:pt-16 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:gap-14 lg:pb-24 lg:pt-14">
          <div className="min-w-0 max-w-xl lg:py-8">
            <p className="eyebrow flex items-center gap-3">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-olive" />
              Cuts, color & everyday hair care
            </p>
            <h1 id="hero-title" className="hero-title mt-5 font-display leading-[1.04] tracking-[-0.055em] text-forest sm:mt-7">
              Good hair.<br />
              <span className="italic text-olive">Great energy.</span>
            </h1>
            <p className="mt-5 max-w-[25rem] text-base leading-7 text-muted sm:mt-7 sm:text-lg sm:leading-8">
              A fresh shape, a root touch-up, or a smooth blowout.
              Explore the service menu and find the right fit for your next salon visit.
            </p>
            <div className="mt-7 flex flex-col gap-2 sm:mt-9 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-7 sm:gap-y-4">
              <BookingButton className="button-primary w-full sm:w-auto" />
              <a href="#services" className="group inline-flex min-h-12 items-center justify-center gap-3 text-sm font-medium text-forest sm:justify-start">
                Explore our services
                <ArrowIcon className="h-4 w-4 rotate-[135deg] transition-transform group-hover:translate-y-1" />
              </a>
            </div>
            <div className="mt-7 flex items-center gap-4 border-t border-line pt-5 sm:mt-14 sm:pt-6">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#e9ecdf]">
                <LeafIcon className="h-6 w-6 text-olive" />
              </div>
              <p className="text-sm leading-6 text-muted">
                Not sure where to start?<br />
                <span className="font-medium text-forest">Compare service times and prices below.</span>
              </p>
            </div>
          </div>

          <div className="relative mx-auto min-w-0 w-full max-w-xl sm:pb-5 lg:max-w-none">
            <div className="hero-photo relative aspect-[4/3] overflow-hidden bg-[#dce1d5] sm:aspect-[1/1.02] lg:aspect-[0.91]">
              <Image
                src="/images/salon-interior.jpg"
                alt="A calm salon interior with round mirrors, styling chairs, and hanging greenery"
                fill
                priority
                sizes="(max-width: 639px) calc(100vw - 40px), (max-width: 1023px) 576px, (max-width: 1279px) calc((100vw - 168px) / 2.05), 543px"
                className="object-cover object-[38%_center]"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-forest/20 to-transparent" />
            </div>
            <div className="absolute -right-5 top-8 hidden h-28 w-28 -rotate-12 flex-col items-center justify-center gap-1 rounded-full border-[5px] border-cream bg-forest text-cream sm:flex">
              <FlowerIcon className="h-10 w-10 text-[#d9dfb7]" />
              <span className="text-[9px] font-medium uppercase tracking-[0.17em]">Made for you</span>
            </div>
            <div className="relative mx-3 -mt-6 flex items-center gap-3 rounded-xl border border-line bg-cream px-4 py-4 shadow-[0_12px_30px_-15px_rgba(38,60,50,0.25)] sm:absolute sm:-left-6 sm:bottom-0 sm:mx-0 sm:mt-0 sm:max-w-[calc(100%-16px)] sm:gap-4 sm:px-6 sm:py-5">
              <ScissorsIcon className="h-8 w-8 shrink-0 text-olive" />
              <div>
                <p className="font-display text-xl tracking-tight text-forest sm:text-2xl">Your feel-good ritual.</p>
                <p className="mt-1 text-xs text-muted sm:text-sm">A little refresh. A lot more you.</p>
              </div>
            </div>
          </div>
        </section>

        <section aria-label="Explore salon services" className="border-y border-line bg-[#edeee5]">
          <div className="page-width grid gap-5 py-7 sm:grid-cols-3 sm:gap-6 sm:py-9">
            {[
              { Icon: ScissorsIcon, title: "Cut & finish", text: "Refresh your length, shape, and style." },
              { Icon: FlowerIcon, title: "Color & highlights", text: "Touch up roots or add dimension." },
              { Icon: LeafIcon, title: "Condition & style", text: "Care for dry ends and finish your look." },
            ].map(({ Icon, title, text }) => (
              <div key={title} className="flex items-center gap-4 sm:justify-center">
                <Icon className="h-8 w-8 shrink-0 text-olive" />
                <div>
                  <h2 className="text-sm font-medium text-forest">{title}</h2>
                  <p className="mt-1 text-xs leading-5 text-muted">{text}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section id="services" aria-labelledby="services-title" className="page-width scroll-mt-6 py-14 sm:scroll-mt-8 sm:py-24">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end md:gap-8">
            <div>
              <p className="eyebrow">The service menu</p>
              <h2 id="services-title" className="section-heading mt-3">A refresh, <span className="italic text-olive">your way.</span></h2>
            </div>
            <p className="max-w-xs text-sm leading-7 text-muted">
              Compare haircuts, color appointments, and styling services.
              Each option shows its appointment length and price.
            </p>
          </div>

          {catalog.source === "preview" && (
            <p className="mt-6 inline-flex max-w-full rounded-xl border border-line px-3 py-2 text-xs leading-5 text-muted sm:mt-7 sm:rounded-full">
              Preview menu · sample services and prices in {salon.currency}
            </p>
          )}
          {catalog.source === "supabase" && catalog.services.length > 0 && (
            <p className="mt-6 text-xs text-muted">All prices in {salon.currency}.</p>
          )}

          {catalog.services.length > 0 ? (
            <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:gap-5">
              {catalog.services.map((service, index) => (
                <li key={service.id} className="service-card group flex min-w-0 flex-col rounded-2xl border border-line p-5 sm:p-7">
                  <div className="flex items-center justify-between">
                    <span className="text-xs tracking-widest text-muted" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                    <FlowerIcon className="h-8 w-8 text-olive/70 transition-transform duration-500 group-hover:rotate-45" />
                  </div>
                  <h3 className="mb-5 mt-5 font-display text-[1.7rem] leading-tight tracking-[-0.025em] text-forest [overflow-wrap:anywhere] sm:mt-7">{service.name}</h3>
                  <div className="mt-auto flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                    <span className="inline-flex items-center gap-2 text-sm tabular-nums text-muted">
                      <ClockIcon className="h-4 w-4 shrink-0" />
                      {formatDuration(service.duration)}
                    </span>
                    <span className="max-w-full text-xl font-medium tabular-nums tracking-tight text-forest [overflow-wrap:anywhere]">{formatPrice(service.price)}</span>
                  </div>
                  <div className="mt-6 border-t border-line pt-4">
                    <BookingButton service={service} preview={catalog.source === "preview"} className="button-service w-full" />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div role="status" className="mt-8 rounded-2xl border border-line bg-white/40 px-6 py-12 text-center">
              <FlowerIcon className="mx-auto mb-5 h-12 w-12 text-olive" />
              <h3 className="font-display text-3xl text-forest">
                {catalog.source === "unavailable" ? "Services are temporarily unavailable." : "The service menu is not available yet."}
              </h3>
              <p className="mx-auto mt-3 max-w-md text-sm leading-7 text-muted">
                {catalog.source === "unavailable"
                  ? "We couldn’t load our services right now. Please try again in a moment."
                  : "Please check back for service details, appointment lengths, and prices."}
              </p>
              {catalog.source === "unavailable" && (
                <form action="/#services" method="get" className="mt-6">
                  <button type="submit" className="button button-primary">Try again <ArrowIcon className="h-4 w-4" /></button>
                </form>
              )}
            </div>
          )}
          <p className="mt-6 text-center text-xs leading-6 text-muted">Choose a service, then view available dates and times.</p>
        </section>

        <section id="approach" aria-labelledby="approach-title" className="page-width scroll-mt-6 pb-14 sm:scroll-mt-8 sm:pb-24">
          <div className="grid gap-6 border-t border-line pt-10 sm:grid-cols-2 sm:gap-16 sm:pt-12">
            <div>
              <p className="eyebrow">Before your appointment</p>
              <h2 id="approach-title" className="mt-4 max-w-md font-display text-4xl leading-[1.15] tracking-[-0.04em] text-forest sm:text-5xl">A style that fits your routine.</h2>
            </div>
            <div className="max-w-lg space-y-4 text-sm leading-8 text-muted sm:pt-6 sm:text-base">
              <p>Bring a few reference photos and think about how much time you like to spend styling at home. A trim, a shorter shape, and a full restyle are different goals. Knowing yours helps guide the conversation with your stylist.</p>
              <p>For color appointments, share any recent coloring or lightening treatments. Your starting shade, hair condition, and desired result help your stylist recommend the right service.</p>
            </div>
          </div>
        </section>

        <section aria-labelledby="closing-title" className="page-width pb-10 sm:pb-14">
          <div className="relative isolate overflow-hidden rounded-[1.5rem] bg-forest px-5 py-10 text-center text-cream sm:px-12 sm:py-16">
            <FlowerIcon className="pointer-events-none absolute -left-16 -top-20 -z-10 h-72 w-72 rotate-12 text-[#d9dfb7]/10" />
            <FlowerIcon className="pointer-events-none absolute -bottom-20 -right-16 -z-10 h-72 w-72 -rotate-12 text-[#d9dfb7]/10" />
            <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-[#d9dfb7]">A trim, a touch-up, or a new look.</p>
            <h2 id="closing-title" className="mt-5 font-display text-4xl leading-tight tracking-[-0.04em] sm:text-5xl">Make a little time <span className="italic text-[#d9dfb7]">for you.</span></h2>
            <p className="mx-auto mb-7 mt-4 max-w-md text-sm leading-7 text-[#dce1d5]">Explore cuts, color, and styling to plan your next salon visit.</p>
            <BookingButton className="button-light w-full sm:w-auto" />
            <p className="mt-4 text-xs text-[#dce1d5]">Pick a date and confirm your appointment online</p>
          </div>
        </section>
      </main>

      <footer className="page-width site-footer flex flex-col justify-between gap-3 border-t border-line py-6 text-xs leading-6 text-muted lg:flex-row lg:items-center lg:gap-5 lg:py-7">
        <div className="flex items-center gap-3">
          <FlowerIcon className="h-6 w-6 text-olive" />
          <p>© {new Date().getFullYear()} {salon.name}. A sample salon concept.</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          <a href="#services" className="nav-link">Explore services</a>
          <a href="https://unsplash.com" className="nav-link" target="_blank" rel="noreferrer">Studio image: Unsplash <span className="sr-only">(opens in a new tab)</span></a>
          <a href="#home" className="nav-link inline-flex items-center gap-1.5">Back to top <ArrowIcon className="h-3 w-3" /></a>
        </div>
      </footer>
    </>
  );
}
