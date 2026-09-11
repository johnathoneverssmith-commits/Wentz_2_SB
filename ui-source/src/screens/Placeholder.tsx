import { Card, CardHeader } from "@/components/primitives";

export function Placeholder({ name, spec }: { name: string; spec?: string }) {
  return (
    <Card>
      <CardHeader badge="FS" title={name} subtitle={spec ?? "Screen scaffold"} />
      <div className="panel open">
        <div className="emptystate">
          This screen is scaffolded and routed. Its ported layout + wiring is coming in a
          later pass of the build.
        </div>
      </div>
    </Card>
  );
}
