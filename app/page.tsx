import { redirect } from "next/navigation";

/*
  One customer, so the root goes straight to theirs. Each organisation gets
  its own address; adding one means adding a folder beside proedgesolutions
  that re-exports the same view.
*/
export default function Page() {
  redirect("/proedgesolutions");
}
