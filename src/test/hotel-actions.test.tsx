import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import {
  HotelBookButton,
  HotelMobileActionBar,
  bookingHref,
  hasHotelContact,
  telHref,
  whatsappHref,
} from "@/components/hotel/HotelActionBar";

const hotel = (over: Partial<Parameters<typeof bookingHref>[0]> = {}) => ({
  name: "Jazeera Palace",
  accentColor: "#0f766e",
  contactPhone: null,
  contactWhatsapp: null,
  ...over,
});

describe("whatsappHref", () => {
  it("strips every non-digit an owner might have typed", () => {
    expect(whatsappHref("+252 61 234 5678")).toBe("https://wa.me/252612345678");
    expect(whatsappHref("(252)-61-234-5678")).toBe("https://wa.me/252612345678");
  });

  it("returns null for anything not dialable", () => {
    expect(whatsappHref(null)).toBeNull();
    expect(whatsappHref("")).toBeNull();
    expect(whatsappHref("n/a")).toBeNull();
    expect(whatsappHref("123")).toBeNull();
  });
});

describe("telHref", () => {
  it("keeps the leading + so the country code survives", () => {
    expect(telHref("+252 61 234 5678")).toBe("tel:+252612345678");
    expect(telHref("061 234 5678")).toBe("tel:0612345678");
  });

  it("returns null for junk", () => {
    expect(telHref("  ")).toBeNull();
    expect(telHref("call us")).toBeNull();
  });
});

describe("bookingHref", () => {
  it("prefers WhatsApp over the phone number", () => {
    expect(
      bookingHref(hotel({ contactWhatsapp: "252611111111", contactPhone: "252622222222" })),
    ).toBe("https://wa.me/252611111111");
  });

  it("falls back to the phone, then to the on-page anchor", () => {
    expect(bookingHref(hotel({ contactPhone: "252622222222" }))).toBe("tel:252622222222");
    expect(bookingHref(hotel(), "#contact")).toBe("#contact");
  });

  it("is null when there is nothing to link to", () => {
    expect(bookingHref(hotel())).toBeNull();
    expect(bookingHref(hotel(), null)).toBeNull();
  });
});

describe("hasHotelContact", () => {
  it("is true only for a reachable number", () => {
    expect(hasHotelContact(hotel())).toBe(false);
    expect(hasHotelContact(hotel({ contactPhone: "252622222222" }))).toBe(true);
    expect(hasHotelContact(hotel({ contactWhatsapp: "252611111111" }))).toBe(true);
  });
});

describe("HotelBookButton", () => {
  it("opens WhatsApp when the hotel has one", () => {
    render(<HotelBookButton hotel={hotel({ contactWhatsapp: "+252 61 111 1111" })} />);
    const link = screen.getByRole("link", { name: /book now/i });
    expect(link).toHaveAttribute("href", "https://wa.me/252611111111");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("renders nothing rather than a dead button", () => {
    const { container } = render(<HotelBookButton hotel={hotel()} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("HotelMobileActionBar", () => {
  it("shows both actions when both numbers exist", () => {
    render(
      <HotelMobileActionBar
        hotel={hotel({ contactWhatsapp: "252611111111", contactPhone: "+252622222222" })}
      />,
    );
    expect(screen.getByRole("link", { name: /whatsapp/i })).toHaveAttribute(
      "href",
      "https://wa.me/252611111111",
    );
    expect(screen.getByRole("link", { name: /call/i })).toHaveAttribute(
      "href",
      "tel:+252622222222",
    );
  });

  it("renders nothing for a hotel with no numbers", () => {
    const { container } = render(<HotelMobileActionBar hotel={hotel()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
