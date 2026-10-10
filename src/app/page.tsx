import Image from "next/image";
import { BookingButton } from "@/components/booking-button";
import { ArrowUp, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatDuration, formatPrice, salon } from "@/lib/salon";
import { loadServiceCatalog } from "@/lib/services";
import { createClient } from "@/lib/supabase/server";
import landing from "./page.module.css";

export const dynamic = "force-dynamic";

const visitSteps = [
  {
    title: "Find your service.",
    description: "Start with the menu. Compare appointment lengths and prices, then choose a service to see available times.",
  },
  {
    title: "Bring your references.",
    description: "Save a few images of the shapes, colors, or details you like. Knowing what you don’t want is useful, too.",
  },
  {
    title: "Share your everyday.",
    description: "Think about your usual routine, your hair’s history, and how much time you like to spend styling it.",
  },
];

const bookingQuestions = [
  {
    question: "Do I need an account to book?",
    answer: "No. Choose a service and an available time, then enter your name and phone number. You don’t need to create an account.",
  },
  {
    question: "When is my appointment reserved?",
    answer: "Only after you select Confirm booking and receive your confirmation. Choosing a time does not hold it. Keep the confirmation and booking reference for your records.",
  },
  {
    question: "Do I pay when I book?",
    answer: "No payment is collected through this website. The menu shows the service price; your booking confirmation reserves the appointment only.",
  },
];

export default async function Home() {
  const catalog = await loadServiceCatalog(
    { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY },
    async () => {
      const supabase = await createClient();
      return await supabase.from("services").select("id, name, duration, price").order("name").abortSignal(AbortSignal.timeout(5000));
    },
  );

  return (
    <div className={landing.site}>
      <a href="#main" className="skip-link">Skip to content</a>

      <header id="home" className={`page-width ${landing.header}`}>
        <a href="#home" aria-label={`${salon.name} home`} className={landing.wordmark}>
          {salon.name.toLowerCase()}<span aria-hidden="true">.</span>
        </a>
        <nav aria-label="Main navigation" className={landing.navigation}>
          <a href="#services">Services</a>
          <a href="#ritual">Your visit</a>
          <a href="#stories">Booking questions</a>
        </nav>
        <BookingButton className={landing.headerBooking} />
      </header>

      <main id="main" tabIndex={-1}>
        <section aria-labelledby="hero-title" className={`page-width ${landing.hero}`}>
          <div className={landing.heroCopy}>
            <p className={landing.introduction}>Hair, with a point of view.</p>
            <h1 id="hero-title" className={landing.heroTitle}>
              A little change.<br />All you.
            </h1>
            <p className={landing.heroDescription}>
              A new shape. A different shade. Or just a refresh.
              Find your next appointment at {salon.name}.
            </p>
            <div className={landing.heroActions}>
              <BookingButton />
              <a href="#services" className={landing.textLink}>Explore services</a>
            </div>
            <p className={landing.heroNote}>Your service. Your time. No account needed.</p>
          </div>

          <figure className={landing.heroFigure}>
            <div className={landing.heroPhoto}>
              <Image
                src="/images/salon-interior.jpg"
                alt="Illustrative salon interior with circular mirrors and black styling chairs"
                fill
                priority
                sizes="(max-width: 639px) calc(100vw - 40px), (max-width: 1023px) calc(100vw - 64px), (max-width: 1279px) 48vw, 600px"
                className={landing.photo}
              />
            </div>
            <figcaption className={landing.photoCaption}>
              A little salon inspiration. Stock photography, not our premises.
            </figcaption>
          </figure>
        </section>

        <section id="services" aria-labelledby="services-title" className={`page-width ${landing.services}`}>
          <div className={landing.menuHeading}>
            <div>
              <h2 id="services-title" className={landing.sectionTitle}>The service menu.</h2>
              <p className={landing.sectionDescription}>
                Find what you have in mind. Choose a service to see appointment times.
              </p>
            </div>
            {catalog.services.length > 0 && <p className={landing.currencyNote}>Prices in {salon.currency}</p>}
          </div>

          {catalog.source === "preview" && (
            <p className={landing.previewNotice}>
              <strong>Preview menu.</strong> These services and prices are examples, not a live salon menu.
              Example services cannot be booked.
            </p>
          )}

          {catalog.services.length > 0 ? (
            <ul className={landing.serviceList} aria-label="Salon services">
              {catalog.services.map((service) => (
                <li key={service.id} className={landing.serviceRow}>
                  <h3 className={landing.serviceName}>{service.name}</h3>
                  <span className={landing.serviceDuration}>
                    <span className="sr-only">Duration: </span>{formatDuration(service.duration)}
                  </span>
                  <span className={landing.servicePrice}>
                    <span className="sr-only">Price: </span>{formatPrice(service.price)}
                  </span>
                  {catalog.source === "preview" ? (
                    <span className={landing.sampleLabel}>Example only</span>
                  ) : (
                    <BookingButton service={service} variant="outline" className={landing.serviceBooking} />
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <Card className={landing.menuEmpty}>
              <CardContent>
                <div role="status">
                  <h3>{catalog.source === "unavailable" ? "The menu is temporarily unavailable." : "The menu is coming soon."}</h3>
                  <p>
                    {catalog.source === "unavailable"
                      ? "We couldn’t load the services right now. Please try again in a moment."
                      : "Please check back for service details, appointment lengths, and prices."}
                  </p>
                </div>
                {catalog.source === "unavailable" && (
                  <form action="/#services" method="get">
                    <Button type="submit" variant="outline">Try again</Button>
                  </form>
                )}
              </CardContent>
            </Card>
          )}
          <div className={landing.menuFootnote}>
            <p>Appointment times are shown after you choose a service.</p>
            <a href="#stories" className={landing.textLink}>Questions about booking?</a>
          </div>
        </section>

        <section id="ritual" aria-labelledby="ritual-title" className={landing.visit}>
          <div className={`page-width ${landing.visitLayout}`}>
            <div className={landing.visitIntro}>
              <p className={landing.sectionLabel}>Before the chair</p>
              <h2 id="ritual-title" className={landing.sectionTitle}>Good hair starts<br />with you.</h2>
              <p className={landing.sectionDescription}>
                You don’t need all the answers before your visit.
                A few references and a little thought about your routine are a useful place to start.
              </p>
              <a href="#services" className={landing.textLink}>Find your service</a>
            </div>
            <ol className={landing.visitSteps}>
              {visitSteps.map((step, index) => (
                <li key={step.title} className={landing.visitStep}>
                  <span className={landing.stepNumber} aria-hidden="true">{index + 1}</span>
                  <div>
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="stories" aria-labelledby="questions-title" className={`page-width ${landing.questions}`}>
          <div>
            <h2 id="questions-title" className={landing.sectionTitle}>Before you book.</h2>
            <p className={landing.sectionDescription}>A few things worth knowing.</p>
          </div>
          <div className={landing.questionList}>
            {bookingQuestions.map(({ question, answer }) => (
              <details key={question} className={landing.question}>
                <summary>
                  {question}
                  <span className={landing.disclosureIcon} aria-hidden="true">
                    <Plus className={landing.disclosurePlus} />
                    <Minus className={landing.disclosureMinus} />
                  </span>
                </summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section aria-labelledby="closing-title" className={landing.closing}>
          <div className={`page-width ${landing.closingLayout}`}>
            <h2 id="closing-title">Your next chapter<br />starts in the chair.</h2>
            <div className={landing.closingAction}>
              <p>A small refresh or a new direction.<br />Make time for what’s next.</p>
              <BookingButton variant="inverted" />
            </div>
          </div>
        </section>
      </main>

      <footer className={`page-width site-footer ${landing.footer}`}>
        <div className={landing.footerBrand}>
          <a href="#home" className={landing.wordmark} aria-label={`${salon.name} home`}>
            {salon.name.toLowerCase()}<span aria-hidden="true">.</span>
          </a>
          <p>A sample salon concept.<br />Brand name, imagery, and copy await owner approval.</p>
        </div>
        <nav aria-label="Footer navigation" className={landing.footerLinks}>
          <a href="#services">Explore services</a>
          <a href="#home">Back to top <ArrowUp className="h-4 w-4" aria-hidden="true" /></a>
        </nav>
        <p className={landing.copyright}>© {new Date().getFullYear()} {salon.name}</p>
      </footer>
    </div>
  );
}
