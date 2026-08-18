import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import HotelFooter, {
  type HotelFooterBrand,
  type HotelFooterPage,
} from "@/components/hotel/HotelFooter";
import { platformHotelPagePath, tenantHotelPagePath } from "@/lib/hotel-links";

const brand: HotelFooterBrand = {
  name: "Jazeera Palace",
  accentColor: "#0f766e",
  tagline: "Sea view rooms in Hamarweyne",
  address: "Maka Al Mukarama Rd, Mogadishu",
  contactPhone: "+252 61 000 0000",
  contactWhatsapp: "+252 61 000 0000",
  contactEmail: "stay@jazeera.example",
  socials: {},
};

// A hotel whose home page is stored with an EMPTY slug and one whose home page
// is spelled "home" must both resolve — the flag decides, not the spelling.
const pages: HotelFooterPage[] = [
  { id: "p1", slug: "", title: "Home", isHome: true },
  { id: "p2", slug: "rooms", title: "Rooms" },
  { id: "p3", slug: "restaurant", title: "Restaurant" },
];

describe("hotel page paths", () => {
  it("routes the home page by its flag, not by its slug spelling", () => {
    const path = platformHotelPagePath("jazeera");
    expect(path({ slug: "", isHome: true })).toBe("/hotels/jazeera");
    expect(path({ slug: "home" })).toBe("/hotels/jazeera");
    // A page promoted to home keeps its old slug in the database; the flag wins.
    expect(path({ slug: "rooms", isHome: true })).toBe("/hotels/jazeera");
    expect(path({ slug: "rooms" })).toBe("/hotels/jazeera/rooms");
  });

  it("roots a tenant's own subdomain at /", () => {
    expect(tenantHotelPagePath({ slug: "", isHome: true })).toBe("/");
    expect(tenantHotelPagePath({ slug: "rooms" })).toBe("/rooms");
  });
});

describe("HotelFooter", () => {
  it("shows the hotel's identity, contacts and other pages", () => {
    render(
      <HotelFooter
        brand={brand}
        pages={pages}
        pagePath={platformHotelPagePath("jazeera")}
        activePageId="p2"
      />,
    );

    expect(screen.getAllByText("Jazeera Palace").length).toBeGreaterThan(0);
    expect(screen.getByText("Maka Al Mukarama Rd, Mogadishu")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /\+252 61 000 0000/ })).toHaveAttribute(
      "href",
      "tel:+252 61 000 0000",
    );
    expect(screen.getByRole("link", { name: "WhatsApp" })).toHaveAttribute(
      "href",
      "https://wa.me/252610000000",
    );
    expect(screen.getByRole("link", { name: "Restaurant" })).toHaveAttribute(
      "href",
      "/hotels/jazeera/restaurant",
    );
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/hotels/jazeera");
    // The page being viewed is marked rather than hidden.
    expect(screen.getByRole("link", { name: "Rooms" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /Powered by Mogadishu Rents/ })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it("omits sections with no data instead of rendering empty rows", () => {
    render(
      <HotelFooter
        brand={{ name: "Small Guesthouse", accentColor: "#0f766e" }}
        pages={[{ id: "p1", slug: "", title: "Home", isHome: true }]}
        pagePath={tenantHotelPagePath}
      />,
    );

    expect(screen.queryByText("Contact")).not.toBeInTheDocument();
    expect(screen.queryByText("Pages")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Facebook" })).not.toBeInTheDocument();
    // The credit survives even on the barest hotel.
    expect(screen.getByRole("link", { name: /Powered by Mogadishu Rents/ })).toBeInTheDocument();
  });

  it("renders only real URLs from the social fields", () => {
    render(
      <HotelFooter
        brand={{
          ...brand,
          socials: { facebook: "https://facebook.com/jazeera", instagram: "@jazeera" },
        }}
        pages={pages}
        pagePath={tenantHotelPagePath}
      />,
    );

    expect(screen.getByRole("link", { name: "Facebook" })).toHaveAttribute(
      "href",
      "https://facebook.com/jazeera",
    );
    expect(screen.queryByRole("link", { name: "Instagram" })).not.toBeInTheDocument();
  });

  it("shrinks to the page links when the page already has a contact block", () => {
    const { container } = render(
      <HotelFooter
        brand={brand}
        pages={pages}
        pagePath={tenantHotelPagePath}
        hasContactSection
      />,
    );

    expect(screen.getByRole("link", { name: "Rooms" })).toBeInTheDocument();
    // The contact block directly above already carries these.
    expect(screen.queryByText("Maka Al Mukarama Rd, Mogadishu")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Powered by Mogadishu Rents/ }),
    ).not.toBeInTheDocument();
    expect(container.querySelector("footer")).not.toBeNull();
  });

  it("renders nothing when a contact page has nowhere else to go", () => {
    const { container } = render(
      <HotelFooter
        brand={brand}
        pages={[{ id: "p1", slug: "", title: "Home", isHome: true }]}
        pagePath={tenantHotelPagePath}
        hasContactSection
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
