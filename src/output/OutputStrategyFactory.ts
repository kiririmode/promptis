import { ChatOnlyOutputStrategy } from "./ChatOnlyOutputStrategy";
import { FileOnlyOutputStrategy } from "./FileOnlyOutputStrategy";
import { OutputStrategy } from "./OutputStrategy";

/**
 * OutputStrategy生成Factory
 * 出力モードに基づいて適切なStrategyインスタンスを生成
 */
export class OutputStrategyFactory {
  /**
   * 指定されたモードに対応するOutputStrategyを生成
   * @param mode 出力モード（"chat-only" | "file-only"）
   * @returns 対応するOutputStrategy実装
   */
  static create(mode: string): OutputStrategy {
    switch (mode) {
      case "chat-only":
        return new ChatOnlyOutputStrategy();
      case "file-only":
        return new FileOnlyOutputStrategy();
      default:
        // 未知の値の場合はデフォルトとしてchat-onlyを使用
        console.warn(`Unknown output mode: ${mode}. Falling back to chat-only.`);
        return new ChatOnlyOutputStrategy();
    }
  }
}