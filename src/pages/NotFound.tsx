import { useLocation } from "react-router-dom";
import { useEffect } from "react";

import Seo from "@/components/Seo";
import { absoluteUrl, buildTitle } from "@/lib/seo";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted">
      {/* noindex is the only correct answer here. vercel.json rewrites every
          unknown path to index.html, so this page is served with HTTP 200 — a
          "soft 404". Without an explicit noindex, Google will index an unbounded
          number of garbage URLs (typos, old links, scanner probes) as real,
          successful pages. The canonical is self-referential rather than
          pointing at "/": a canonical to the homepage would ask Google to merge
          every bad URL's signals INTO the homepage, which is the same mistake
          this whole change exists to undo. */}
      <Seo
        title={buildTitle("Page Not Found (404)")}
        description="The page you are looking for does not exist. Browse verified houses, apartments and hotels for rent in Mogadishu instead."
        canonical={absoluteUrl(location.pathname)}
        noindex
      />
      <div className="text-center">
        <h1 className="mb-4 text-4xl font-bold">404</h1>
        <p className="mb-4 text-xl text-muted-foreground">Oops! Page not found</p>
        <a href="/" className="text-primary underline hover:text-primary/90">
          Return to Home
        </a>
        <span className="text-muted-foreground mx-2">·</span>
        <a href="/showcase" className="text-primary underline hover:text-primary/90">
          Platform Overview
        </a>
      </div>
    </div>
  );
};

export default NotFound;
