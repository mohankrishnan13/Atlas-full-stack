import { ShieldCheck } from "lucide-react";

export function AtlasLogo() {
    return (
        <div className="flex justify-center items-center gap-2 mb-4">
            <ShieldCheck className="h-10 w-10 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight text-foreground">ATLAS</h1>
        </div>
    )
}
