import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatINR } from "@/lib/money";

type Part = { label: string; paise: number; href?: string };

/**
 * The money-math block, laid out as the equation it actually is:
 *
 *     Opening  +  Money in  −  Money out  =  Closing
 *
 * The first version rendered eight equal-weight cards in a flat grid, which
 * hid two things worth seeing. First, that these figures form a single
 * arithmetic chain — nothing in the layout said the first four add up to the
 * last. Second, that "Billed" was sitting among them despite not being cash
 * at all: money invoiced is not money received, and totalling it beside
 * Collected invites exactly the wrong conclusion. Billed now lives in its
 * own "owed to you" block, outside this equation.
 *
 * The version after that kept the chain but drew all four terms as columns
 * of one card, with each breakdown line stretched edge-to-edge inside its
 * column. At full width the line items ended up further from their own
 * heading than from the next column's operator, so "Collected from clients
 * … ₹79,920" read as if the amount belonged to the column on its right.
 * Each term is now its own card: a card is a boundary the eye already
 * trusts, so a figure can no longer appear to sit under the wrong heading.
 *
 * Adjustments net out either way, so they are filed under whichever side
 * their sign puts them on; that keeps in − out = net true on screen instead
 * of only in the engine.
 */
export function CashFlowSummary({
  openingPaise,
  openingBalancesAddedPaise,
  collectedPaise,
  creditsPaise,
  expensesPaise,
  lentPaise,
  loanRepaidPaise,
  adjustmentsNetPaise,
  closingPaise,
}: {
  openingPaise: number;
  openingBalancesAddedPaise: number;
  collectedPaise: number;
  creditsPaise: number;
  expensesPaise: number;
  lentPaise: number;
  loanRepaidPaise: number;
  adjustmentsNetPaise: number;
  closingPaise: number;
}) {
  const adjustmentsIn = adjustmentsNetPaise > 0 ? adjustmentsNetPaise : 0;
  const adjustmentsOut = adjustmentsNetPaise < 0 ? -adjustmentsNetPaise : 0;

  // Every component of netCashFlow has to appear on one side or the other,
  // or the equation stops adding up ON SCREEN even while the engine is
  // right. Lending was missing here at first: the columns read
  // opening + 0 − expenses while Closing already had the loans netted out,
  // so the card silently disagreed with itself by exactly the amount lent.
  const inParts: Part[] = [
    { label: "Collected from clients", paise: collectedPaise, href: "/ledger/overview?type=PAYMENT_IN" },
    { label: "Credits received", paise: creditsPaise, href: "/ledger/overview?type=CREDIT_IN" },
    ...(loanRepaidPaise > 0
      ? [
          {
            label: "Loans repaid to you",
            paise: loanRepaidPaise,
            href: "/ledger/overview?type=LOAN_REPAY_IN",
          },
        ]
      : []),
    ...(adjustmentsIn > 0
      ? [{ label: "Adjustments", paise: adjustmentsIn, href: "/ledger/overview?type=ADJUSTMENT" }]
      : []),
    // No drill-down: an account's opening balance is declared at creation,
    // not posted as a ledger row, so there is no transaction list to send
    // anyone to. It is here because it moves the closing position and the
    // equation would otherwise be short by exactly this much.
    ...(openingBalancesAddedPaise > 0
      ? [{ label: "Account opening balances", paise: openingBalancesAddedPaise }]
      : []),
  ];
  const outParts: Part[] = [
    { label: "Expenses paid", paise: expensesPaise, href: "/ledger/overview?type=EXPENSE_OUT" },
    ...(lentPaise > 0
      ? [{ label: "Lent to people", paise: lentPaise, href: "/ledger/overview?type=LOAN_OUT" }]
      : []),
    ...(adjustmentsOut > 0
      ? [{ label: "Adjustments", paise: adjustmentsOut, href: "/ledger/overview?type=ADJUSTMENT" }]
      : []),
  ];

  const totalIn = inParts.reduce((sum, p) => sum + p.paise, 0);
  const totalOut = outParts.reduce((sum, p) => sum + p.paise, 0);

  // Same idea as DevSumAssertion: the equation this card DRAWS must be the
  // equation the engine COMPUTED. Adding a balance-affecting flow to
  // netCashFlow and forgetting to list it here leaves a card that visibly
  // fails to add up — which is exactly how the loans omission shipped past
  // a green typecheck and a green test suite.
  if (process.env.NODE_ENV === "development" && openingPaise + totalIn - totalOut !== closingPaise) {
    throw new Error(
      `[DEV ASSERTION] CashFlowSummary does not balance: opening ${openingPaise} + in ${totalIn} - out ${totalOut} = ${openingPaise + totalIn - totalOut}, but closing is ${closingPaise}. A flow counted in netCashFlow is missing from inParts/outParts.`
    );
  }

  return (
    <div className="grid items-stretch gap-2 md:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] md:gap-0">
      <Term title="Opening" total={openingPaise} hint="Position at the start of the period" href="#per-account" />
      <Operator symbol="+" />
      <Term title="Money in" total={totalIn} tone="in" parts={inParts} />
      <Operator symbol="−" />
      <Term title="Money out" total={totalOut} tone="out" parts={outParts} />
      <Operator symbol="=" />
      <Term title="Closing" total={closingPaise} hint="Across every account" href="#per-account" emphasis />
    </div>
  );
}

/** Visible on desktop as the maths it is; on mobile the cards stack, so the
 * operator becomes a centered symbol between them rather than a floating
 * one beside them. */
function Operator({ symbol }: { symbol: string }) {
  return (
    <div
      aria-hidden="true"
      className="flex items-center justify-center text-lg font-medium text-muted-foreground md:px-2"
    >
      {symbol}
    </div>
  );
}

function Term({
  title,
  total,
  parts,
  hint,
  href,
  tone,
  emphasis,
}: {
  title: string;
  total: number;
  parts?: Part[];
  hint?: string;
  href?: string;
  tone?: "in" | "out";
  emphasis?: boolean;
}) {
  const amount = (
    <span
      className={cn(
        "text-2xl font-semibold tabular-nums",
        tone === "in" && "text-money-in",
        tone === "out" && "text-money-out"
      )}
    >
      {formatINR(total)}
    </span>
  );

  return (
    <Card className={cn("h-full", emphasis && "border-foreground/20 bg-muted/30")}>
      <CardContent className="grid content-start gap-1 py-4">
        <p className="text-xs font-medium text-muted-foreground">{title}</p>
        {href ? (
          <Link href={href} className="w-fit rounded-sm hover:underline">
            {amount}
          </Link>
        ) : (
          amount
        )}
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        {parts && parts.length > 0 ? (
          <ul className="mt-2 grid gap-1 border-t pt-2">
            {parts.map((part) => (
              <li key={part.label} className="flex items-baseline justify-between gap-2 text-xs">
                {part.href ? (
                  <Link href={part.href} className="text-muted-foreground hover:underline">
                    {part.label}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">{part.label}</span>
                )}
                <span className="tabular-nums">{formatINR(part.paise)}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}
