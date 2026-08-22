import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function Home() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/30 p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>YouTube Planner</CardTitle>
          <CardDescription>
            STEP 0 — 배포 파이프라인 확인용 화면입니다.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5">
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>Next.js App Router</li>
            <li>Tailwind CSS</li>
            <li>shadcn/ui</li>
            <li>한글 폰트 (Noto Sans KR)</li>
          </ul>

          <Button className="w-full">
            이 버튼이 보이면 정상입니다
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}