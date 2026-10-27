import { redirect } from "next/navigation";

// /q4 is the legacy URL — permanently redirect to the canonical route.
export default function Q4Page() {
  redirect("/results/Q4-FY26");
}
