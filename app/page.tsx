import { getStorefrontData } from "@/lib/store";
import Storefront from "./storefront";

export const dynamic = "force-dynamic";

export default async function Home() {
  const data = await getStorefrontData();
  return (
    <Storefront
      initialProducts={data.products}
      initialSettings={data.settings}
    />
  );
}
