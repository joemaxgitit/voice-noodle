import { redirect } from "next/navigation";

/** The rep's view moved to /view-as so it shows their whole screen, menu and all. */
export default async function Old({ params }: { params: Promise<{ repId: string }> }) {
  const { repId } = await params;
  redirect(`/view-as/${repId}`);
}
