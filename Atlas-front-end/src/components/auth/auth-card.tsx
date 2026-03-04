import { AtlasLogo } from "./atlas-logo";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface AuthCardProps {
    title: string;
    description: string;
    children: React.ReactNode;
    className?: string;
}

export function AuthCard({ title, description, children, className }: AuthCardProps) {
    return (
        <Card className={cn("w-full max-w-md bg-card border-blue-500/20 shadow-lg shadow-blue-500/10", className)}>
            <CardHeader className="text-center">
                <div className="flex justify-center">
                    <AtlasLogo />
                </div>
                <CardTitle className="text-2xl">{title}</CardTitle>
                <CardDescription>{description}</CardDescription>
            </CardHeader>
            <CardContent>
                {children}
            </CardContent>
        </Card>
    )
}
