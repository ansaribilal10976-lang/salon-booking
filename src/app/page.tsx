import Image from "next/image";
import { BookingButton } from "@/components/booking-button";
import { ArrowIcon, ClockIcon, FlowerIcon, LeafIcon, ScissorsIcon } from "@/components/icons";
import { formatDuration, formatPrice, salon } from "@/lib/salon";
import { loadServiceCatalog } from "@/lib/services";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function Home() {
  const catalog = await loadServiceCatalog(
    { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY },
    async () => {
      const supabase = await createClient();
      return await supabase.from("services").select("id, name, duration, price").order("name").abortSignal(AbortSignal.timeout(5000));
    },
  );

  return (
    <>
      <a href="#main" className="skip-link">Skip to content</a>
      <header id="home" className="page-width site-header flex min-h-[76px] items-center justify-between gap-4 border-b border-[var(--ink)]/15">
        <a href="#home" aria-label={`${salon.name} home`} className="flex min-h-12 items-center gap-2 text-[var(--ink)]">
          <span className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--ink)] text-[var(--clay)]"><FlowerIcon className="h-6 w-6" /></span>
          <span className="font-display text-[2rem] leading-none tracking-[-0.08em] sm:text-[2.35rem]">{salon.name.toLowerCase()}<span className="text-[var(--clay)]">.</span></span>
        </a>
        <nav aria-label="Main navigation" className="hidden items-center gap-8 md:flex">
          <a href="#services" className="nav-link">Services</a>
          <a href="#ritual" className="nav-link">The ritual</a>
          <a href="#stories" className="nav-link">Kind words</a>
        </nav>
        <BookingButton className="button-terracotta px-4 sm:px-6" />
      </header>

      <main id="main" tabIndex={-1}>
        <section aria-labelledby="hero-title" className="page-width grid gap-10 pb-16 pt-12 sm:pb-24 sm:pt-20 lg:grid-cols-[0.88fr_1.12fr] lg:items-center lg:gap-20 lg:pt-24">
          <div className="relative z-10 max-w-2xl">
            <div className="flex items-center gap-3 text-[var(--clay-dark)]"><span className="h-2 w-2 rounded-full bg-[var(--clay)]" /><p className="eyebrow">A considered salon in your city</p></div>
            <h1 id="hero-title" className="hero-title mt-6 font-display leading-[0.92] tracking-[-0.075em] text-[var(--ink)]">Hair that feels <span className="italic text-[var(--clay)]">like you.</span></h1>
            <p className="mt-7 max-w-lg text-base leading-8 text-[var(--ink-soft)] sm:text-lg">Thoughtful cuts, luminous color, and unrushed styling for the way you actually live. Come in for a change, leave feeling more yourself.</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <BookingButton className="button-terracotta w-full sm:w-auto" />
              <a href="#services" className="group inline-flex min-h-12 items-center justify-center gap-3 px-2 text-sm font-medium text-[var(--ink)] sm:justify-start">Browse the menu <ArrowIcon className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" /></a>
            </div>
            <div className="mt-12 grid max-w-lg grid-cols-3 border-y border-[var(--line)] py-5">
              <div><p className="font-display text-2xl text-[var(--ink)]">10+</p><p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">years of craft</p></div>
              <div className="border-l border-[var(--line)] pl-4"><p className="font-display text-2xl text-[var(--ink)]">1:1</p><p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">stylist care</p></div>
              <div className="border-l border-[var(--line)] pl-4"><p className="font-display text-2xl text-[var(--ink)]">4.9</p><p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">guest rating</p></div>
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-2xl lg:max-w-none">
            <div className="hero-photo relative aspect-[0.88] overflow-hidden bg-[var(--sand)] sm:aspect-[0.92]">
              <Image src="/images/salon-interior.jpg" alt="A sunlit salon interior with round mirrors, styling chairs, and hanging greenery" fill priority sizes="(max-width: 1023px) calc(100vw - 40px), 620px" className="object-cover object-[38%_center]" />
              <div className="absolute inset-0 bg-gradient-to-t from-[var(--ink)]/35 via-transparent to-[var(--clay)]/10" />
              <div className="hero-orbit -left-16 top-16 h-52 w-52" /><div className="hero-orbit -left-8 top-24 h-36 w-36" />
              <div className="absolute bottom-5 left-5 right-5 flex items-end justify-between gap-4 text-[var(--cream)] sm:bottom-8 sm:left-8 sm:right-8"><p className="max-w-[13rem] font-display text-2xl leading-tight sm:text-3xl">A softer pace for your next appointment.</p><span className="hidden rounded-full border border-[var(--cream)]/60 px-3 py-2 text-[10px] uppercase tracking-[0.16em] sm:inline-flex">Est. 2014</span></div>
            </div>
            <div className="relative -mt-10 ml-auto mr-4 max-w-xs border border-[var(--line)] bg-[var(--paper)] p-5 shadow-[0_20px_40px_-25px_rgba(39,33,30,0.45)] sm:absolute sm:-bottom-8 sm:-left-10 sm:ml-0 sm:mr-0 sm:max-w-[18rem] sm:p-6">
              <p className="eyebrow">Today at Muse</p><p className="mt-3 font-display text-2xl leading-tight text-[var(--ink)]">Make room for a little ritual.</p><p className="mt-3 text-sm leading-6 text-[var(--muted)]">Appointments are held just for you, from the first consultation to the final touch.</p>
            </div>
          </div>
        </section>

        <section className="marquee-strip overflow-hidden" aria-label="Salon specialties">
          <div className="page-width flex min-h-14 items-center justify-between gap-5 overflow-hidden py-3 text-[10px] font-medium uppercase tracking-[0.2em] sm:text-xs"><span>Cut & shape</span><span className="h-1 w-1 rounded-full bg-current" aria-hidden="true" /><span>Color & dimension</span><span className="h-1 w-1 rounded-full bg-current" aria-hidden="true" /><span>Care & finish</span><span className="h-1 w-1 rounded-full bg-current" aria-hidden="true" /><span className="hidden sm:inline">Good energy only</span></div>
        </section>

        <section id="ritual" aria-labelledby="ritual-title" className="page-width scroll-mt-8 py-20 sm:py-32">
          <div className="grid gap-12 lg:grid-cols-[0.75fr_1.25fr] lg:gap-24">
            <div><p className="eyebrow">The Muse approach</p><h2 id="ritual-title" className="section-heading mt-4">The art of feeling <span className="italic text-[var(--clay)]">like yourself.</span></h2></div>
            <div className="grid gap-8 sm:grid-cols-2 sm:gap-12"><p className="pt-1 text-base leading-8 text-[var(--ink-soft)]">We believe a salon visit should give something back. Time to talk, time to decide, and time to leave with a shape that works beyond the mirror.</p><div className="border-l border-[var(--line)] pl-6 sm:pl-8"><p className="font-display text-5xl text-[var(--clay)]">01</p><h3 className="mt-4 text-sm font-semibold uppercase tracking-[0.12em] text-[var(--ink)]">Start with you</h3><p className="mt-3 text-sm leading-7 text-[var(--muted)]">Your routine, your references, and the version of yourself you want to meet today.</p></div></div>
          </div>
          <div className="mt-16 grid gap-4 sm:grid-cols-3 sm:gap-5">
            {[{ Icon: ScissorsIcon, title: "Intentional cuts", text: "Shapes designed to grow out beautifully and fit your everyday." }, { Icon: FlowerIcon, title: "Thoughtful color", text: "Dimension, shine, and a plan that respects your hair." }, { Icon: LeafIcon, title: "Quiet care", text: "A considered finish with space to breathe and reset." }].map(({ Icon, title, text }, index) => <article key={title} className={`p-6 sm:p-8 ${index === 1 ? "clay-panel" : index === 2 ? "sage-panel" : "soft-panel"}`}><Icon className={`h-8 w-8 ${index === 1 ? "text-[var(--blush)]" : "text-[var(--clay)]"}`} /><h3 className="mt-12 font-display text-2xl">{title}</h3><p className={`mt-3 text-sm leading-7 ${index === 1 ? "text-[var(--cream)]/75" : "text-[var(--muted)]"}`}>{text}</p></article>)}
          </div>
        </section>

        <section id="services" aria-labelledby="services-title" className="scroll-mt-8 bg-[var(--sand)] py-20 sm:py-28">
          <div className="page-width">
            <div className="flex flex-col justify-between gap-7 md:flex-row md:items-end"><div><p className="eyebrow">The menu</p><h2 id="services-title" className="section-heading mt-4">Choose your <span className="italic text-[var(--clay)]">moment.</span></h2></div><p className="max-w-sm text-sm leading-7 text-[var(--ink-soft)]">Every appointment starts with a conversation and ends with a little more ease. Pick a service to see times that work for you.</p></div>
            {catalog.source === "preview" && <p className="mt-7 inline-flex rounded-full border border-[var(--line)] bg-[var(--paper)] px-4 py-2 text-xs text-[var(--muted)]">Preview menu · sample prices in {salon.currency}</p>}
            {catalog.source === "supabase" && catalog.services.length > 0 && <p className="mt-7 text-xs text-[var(--muted)]">All prices in {salon.currency} · appointment times are shown after you choose a service.</p>}
            {catalog.services.length > 0 ? <ul className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {catalog.services.map((service, index) => <li key={service.id} className="service-card group p-6 sm:p-8"><div className="flex items-start justify-between gap-3"><span className="font-mono text-xs text-[var(--clay)]">{String(index + 1).padStart(2, "0")}</span><FlowerIcon className="h-7 w-7 text-[var(--clay)]/70 transition-transform duration-300 group-hover:rotate-45" /></div><h3 className="mt-16 font-display text-3xl leading-tight tracking-[-0.03em] text-[var(--ink)] [overflow-wrap:anywhere]">{service.name}</h3><div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-5"><span className="inline-flex items-center gap-2 text-sm text-[var(--muted)]"><ClockIcon className="h-4 w-4 text-[var(--clay)]" />{formatDuration(service.duration)}</span><span className="font-display text-2xl text-[var(--ink)]">{formatPrice(service.price)}</span></div><BookingButton service={service} preview={catalog.source === "preview"} className="button-outline mt-7 w-full justify-between" /></li>)}
            </ul> : <div role="status" className="mt-10 bg-[var(--paper)] px-6 py-14 text-center"><FlowerIcon className="mx-auto h-12 w-12 text-[var(--clay)]" /><h3 className="mt-5 font-display text-3xl text-[var(--ink)]">{catalog.source === "unavailable" ? "Services are temporarily unavailable." : "The menu is coming soon."}</h3><p className="mx-auto mt-3 max-w-md text-sm leading-7 text-[var(--muted)]">{catalog.source === "unavailable" ? "We couldn’t load our services right now. Please try again in a moment." : "Please check back for service details, appointment lengths, and prices."}</p>{catalog.source === "unavailable" && <form action="/#services" method="get" className="mt-6"><button type="submit" className="button button-primary mx-auto">Try again <ArrowIcon className="h-4 w-4" /></button></form>}</div>}
            <p className="mt-7 text-center text-xs text-[var(--muted)]">Not sure what to choose? <a href="#ritual" className="font-medium text-[var(--clay-dark)] underline underline-offset-4">Start with your routine.</a></p>
          </div>
        </section>

        <section id="stories" aria-labelledby="stories-title" className="page-width scroll-mt-8 py-20 sm:py-32">
          <div className="flex flex-col justify-between gap-5 border-b border-[var(--line)] pb-8 sm:flex-row sm:items-end"><div><p className="eyebrow">Kind words</p><h2 id="stories-title" className="section-heading mt-4">A few words from the <span className="italic text-[var(--clay)]">chair.</span></h2></div><p className="text-sm text-[var(--muted)]">The best part of the work is how you feel when you leave.</p></div>
          <div className="mt-10 grid gap-5 lg:grid-cols-3">{[{ quote: "I walked in wanting a trim and left with the exact shape I’d been trying to explain for years.", name: "Ananya R.", detail: "Cut & finish" }, { quote: "The color is soft, shiny, and somehow still looks like me. It grows out so beautifully.", name: "Maya S.", detail: "Dimensional color" }, { quote: "It never feels rushed here. I leave with good hair and a genuinely better mood.", name: "Nisha K.", detail: "Blowout ritual" }].map(({ quote, name, detail }) => <figure key={name} className="soft-panel p-6 sm:p-8"><div className="flex items-center gap-1" aria-label="Loved by guests">{[1, 2, 3, 4, 5].map((dot) => <span key={dot} className="h-1.5 w-1.5 rounded-full bg-[var(--clay)]" aria-hidden="true" />)}</div><blockquote className="mt-8 font-display text-2xl leading-tight text-[var(--ink)]">“{quote}”</blockquote><figcaption className="mt-8 border-t border-[var(--line)] pt-4 text-xs uppercase tracking-[0.14em] text-[var(--muted)]">{name} · {detail}</figcaption></figure>)}</div>
        </section>

        <section aria-labelledby="closing-title" className="page-width pb-12 sm:pb-20"><div className="dark-panel relative isolate overflow-hidden px-6 py-14 sm:px-16 sm:py-20"><FlowerIcon className="pointer-events-none absolute -right-20 -top-24 -z-10 h-96 w-96 rotate-12 text-[var(--clay)]/20" /><p className="eyebrow text-[var(--blush)]">Your next good hair day</p><h2 id="closing-title" className="mt-5 max-w-3xl font-display text-5xl leading-[0.98] tracking-[-0.06em] sm:text-7xl">Make a little time <span className="italic text-[var(--blush)]">for you.</span></h2><div className="mt-10 flex flex-col justify-between gap-7 border-t border-[var(--cream)]/20 pt-7 sm:flex-row sm:items-end"><p className="max-w-sm text-sm leading-7 text-[var(--cream)]/70">Choose a service, find a time that suits you, and leave the rest to us.</p><BookingButton className="button-light w-full sm:w-auto" /></div></div></section>
      </main>

      <footer className="page-width site-footer flex flex-col justify-between gap-4 border-t border-[var(--line)] py-7 text-xs leading-6 text-[var(--muted)] sm:flex-row sm:items-center"><div className="flex items-center gap-3"><span className="flex h-7 w-7 items-center justify-center rounded-full border border-[var(--clay)] text-[var(--clay)]"><FlowerIcon className="h-4 w-4" /></span><p>© {new Date().getFullYear()} {salon.name}. Made for your everyday.</p></div><div className="flex flex-wrap items-center gap-x-5 gap-y-1"><a href="#services" className="nav-link text-xs">Explore services</a><a href="#home" className="nav-link text-xs">Back to top <ArrowIcon className="ml-1 h-3 w-3 -rotate-45" /></a></div></footer>
    </>
  );
}
