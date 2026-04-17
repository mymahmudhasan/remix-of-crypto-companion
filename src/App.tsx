import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/AppLayout";
import Index from "./pages/Index.tsx";
import Scanner from "./pages/Scanner.tsx";
import Spot from "./pages/Spot.tsx";
import Futures from "./pages/Futures.tsx";
import PumpDump from "./pages/PumpDump.tsx";
import Unlocks from "./pages/Unlocks.tsx";
import Plans from "./pages/Plans.tsx";
import SmartMoney from "./pages/SmartMoney.tsx";
import News from "./pages/News.tsx";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Index />} />
            <Route path="/scanner" element={<Scanner />} />
            <Route path="/spot" element={<Spot />} />
            <Route path="/futures" element={<Futures />} />
            <Route path="/pump-dump" element={<PumpDump />} />
            <Route path="/unlocks" element={<Unlocks />} />
            <Route path="/plans" element={<Plans />} />
            <Route path="/smart-money" element={<SmartMoney />} />
            <Route path="/news" element={<News />} />
          </Route>
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
