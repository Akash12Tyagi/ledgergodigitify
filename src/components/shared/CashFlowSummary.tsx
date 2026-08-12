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
 * The previous version rendered eight equal-weight cards in a flat grid,
 * which hid two things worth seeing. First, that these figures form a single
 * arithmetic chain — nothing in the layout said the first four add up to the
 * last. Second, that "Billed" was sitting among them despite not being cash
 * at all: money invoiced is not money received, and totalling it beside
 * Collected invites exactly the wrong conclusion. Billed now lives in its
 * own "owed to you" block, outside this equation.
 *
 * Adjustments net out either way, so they are filed under whichever side
 * their sign puts them on; that keeps in − out = net true on screen instead
 * of only in the engine.
 */
export function CashFlowSummary({
  openingPaise,
  collectedPaise,
  creditsPaise,
  expensesPaise,
  lentPaise,
  loanRepaidPaise,
  adjustmentsNetPaise,
  closingPaise,
}: {
  openingPaise: number;
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
    <Card>
      <CardContent className="grid gap-0 md:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr]">
        <Column title="Opening" total={openingPaise} hint="What you started the period with" href="#per-account" />
        <Operator symbol="+" />
        <Column title="Money in" total={totalIn} tone="in" parts={inParts} />
        <Operator symbol="−" />
        <Column title="Money out" total={totalOut} tone="out" parts={outParts} />
        <Operator symbol="=" />
        <Column title="Closing" total={closingPaise} hint="Across every account" href="#per-account" emphasis />
      </CardContent>
    </Card>
  );
}

/** Visible on desktop as the maths it is; on mobile the columns stack, so
 * the operator becomes a divider rather than a floating symbol. */
function Operator({ symbol }: { symbol: string }) {
  return (
    <div
      aria-hidden="true"
      className="flex items-center justify-center py-2 text-lg font-medium text-muted-foreground md:px-3 md:py-0"
    >
      <span className="hidden md:inline">{symbol}</span>
      <span className="h-px w-full bg-border md:hidden" />
    </div>
  );
}

function Column({
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
        tone === "out" && "text-money-out",
        emphasis && "text-2xl"
      )}
    >
      {formatINR(total)}
    </span>
  );

  return (
    <div className="grid content-start gap-1 py-2">
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
        <ul className="mt-1 grid gap-0.5">
          {parts.map((part) => (
            <li key={part.label} className="flex items-baseline justify-between gap-3 text-xs">
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
    </div>
  );
}
