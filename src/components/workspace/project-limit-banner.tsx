import { AlertTriangle, XCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface ProjectLimitBannerProps {
  currentCount: number;
  limit: number;
}

export function ProjectLimitBanner({ currentCount, limit }: ProjectLimitBannerProps) {
  if (currentCount < 45) return null;

  const isAtLimit = currentCount >= limit;

  if (isAtLimit) {
    return (
      <Alert variant="destructive">
        <XCircle className="h-4 w-4" />
        <AlertTitle>已达到项目上限</AlertTitle>
        <AlertDescription>
          <p>
            当前活跃项目：{currentCount}/{limit}。无法继续创建新项目。
          </p>
          <ul className="mt-2 list-disc pl-4 space-y-1">
            <li>归档已完成的项目以释放配额</li>
            <li>升级套餐以获取更高上限</li>
            <li>联系管理员申请扩容</li>
          </ul>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert variant="warning">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>即将达到项目上限</AlertTitle>
      <AlertDescription>
        当前活跃项目：{currentCount}/{limit}。建议归档不再使用的项目。
      </AlertDescription>
    </Alert>
  );
}
