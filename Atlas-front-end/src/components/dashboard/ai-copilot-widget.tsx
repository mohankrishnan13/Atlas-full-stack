'use client';

import React from 'react';
import { Bot, Send, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from '@/components/ui/input';
import { useChat } from '@ai-sdk/react';
import { ScrollArea } from '../ui/scroll-area';
import { Avatar, AvatarFallback } from '../ui/avatar';
import { cn } from '@/lib/utils';


export function AiCopilotWidget() {
  const [isOpen, setIsOpen] = React.useState(false);
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat({
    api: '/api/copilot',
  });

  return (
    <>
      <div className="fixed bottom-6 right-6 z-50">
        <Button
          size="lg"
          className="rounded-full h-16 w-16 shadow-lg"
          onClick={() => setIsOpen(true)}
        >
          <Bot className="h-8 w-8" />
          <span className="sr-only">Ask AI Copilot</span>
        </Button>
      </div>
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="sm:max-w-[525px] flex flex-col h-[70vh] max-h-[700px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bot className="h-6 w-6" />
              AI Copilot
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="flex-1 -mx-6 px-6">
            <div className="space-y-4 pr-4">
              {messages.length === 0 && (
                 <div className="text-center text-muted-foreground pt-8">
                    <p>Ask me anything about system health, incidents, or trends.</p>
                    <p className="text-xs mt-2">e.g., "Summarize critical alerts from the last 24 hours."</p>
                </div>
              )}
              {messages.map((m) => (
                <div key={m.id} className={cn("flex items-start gap-3", m.role === 'user' ? "justify-end" : "justify-start")}>
                  {m.role === 'assistant' && <Avatar className="w-8 h-8"><AvatarFallback><Bot size={20}/></AvatarFallback></Avatar>}
                  <div
                    className={cn(
                      "max-w-[80%] rounded-lg p-3 text-sm",
                      m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-secondary'
                    )}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
               {isLoading && (
                 <div className="flex items-start gap-3 justify-start">
                    <Avatar className="w-8 h-8"><AvatarFallback><Bot size={20}/></AvatarFallback></Avatar>
                    <div className="bg-secondary rounded-lg p-3">
                        <LoaderCircle className="animate-spin h-5 w-5" />
                    </div>
                </div>
              )}
            </div>
          </ScrollArea>
          <DialogFooter>
            <form onSubmit={handleSubmit} className="flex w-full items-center space-x-2">
              <Input
                value={input}
                onChange={handleInputChange}
                placeholder="Ask a question..."
                autoComplete="off"
              />
              <Button type="submit" size="icon">
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
