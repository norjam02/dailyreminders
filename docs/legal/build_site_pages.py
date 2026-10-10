"""Builds the DailyPulse Terms, Privacy, and Support pages for condorllc.org.

The markdown files next to this script are the source. The pages go in the
website repo at assets/dailypulse/, styled to match the site, kept out of the
site's menus and search results.

    python3 docs/legal/build_site_pages.py ../condorllc-site
"""

import html
import sys
from pathlib import Path

import markdown

HERE = Path(__file__).parent

PAGES = [
    ("terms", "Terms of Use", "The terms for using the DailyPulse app from Condor LLC."),
    ("privacy", "Privacy Policy", "What the DailyPulse app collects, how it's used, and your choices."),
    ("support", "Support", "Help with the DailyPulse app."),
]

TEMPLATE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DailyPulse {title} | Condor</title>
<meta name="description" content="{description}">
<meta name="robots" content="noindex">
<link rel="canonical" href="https://condorllc.org/assets/dailypulse/{slug}.html">
<link rel="icon" type="image/png" href="../condor-mark.png">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=Inter:wght@400;500;600;700;800&display=swap">
<link rel="stylesheet" href="../../styles.css">
<link rel="stylesheet" href="legal.css">
</head>
<body>
<nav id="site-nav">
  <a class="nav-logo" href="../../index.html" aria-label="CONDOR home"><img class="brand-mark" src="../condor-mark.png" alt="">CONDOR</a>
</nav>

<main>
<header class="page-header">
  <p class="hero-eyebrow">DailyPulse</p>
  <h1>{title}</h1>
</header>

<section class="section-white">
  <article class="legal">
    <ul class="legal-tabs">
{tabs}
    </ul>
{body}
  </article>
</section>
</main>

<footer>
  <a class="footer-logo" href="../../index.html"><img class="brand-mark" src="../condor-mark.png" alt="">CONDOR</a>
  <div class="footer-right">
    <a href="mailto:support@condorllc.org">support@condorllc.org</a>
    <p>&copy; 2026 Condor LLC. All rights reserved.</p>
  </div>
</footer>
</body>
</html>
"""


def build(site: Path) -> None:
    out = site / "assets" / "dailypulse"
    out.mkdir(parents=True, exist_ok=True)
    for slug, title, description in PAGES:
        source = (HERE / f"{slug}.md").read_text()
        body = markdown.markdown(source, extensions=["tables"])
        body = body.replace("<table>", '<div class="legal-table"><table>').replace("</table>", "</table></div>")
        tabs = "\n".join(
            f'      <li><a href="{s}.html"{" aria-current=\"page\"" if s == slug else ""}>{html.escape(t)}</a></li>'
            for s, t, _ in PAGES
        )
        page = TEMPLATE.format(
            slug=slug,
            title=html.escape(title),
            description=html.escape(description),
            tabs=tabs,
            body="\n".join("    " + line if line else "" for line in body.splitlines()),
        )
        # Google Play links to this section for account deletion.
        page = page.replace("<h2>Delete your account</h2>", '<h2 id="delete">Delete your account</h2>')
        (out / f"{slug}.html").write_text(page)
        print(f"wrote {out / (slug + '.html')}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: build_site_pages.py <path to condorllc-site>")
    build(Path(sys.argv[1]))
