import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dragon's Reign - Medieval Survival",
  description: "Control a dragon in an open 3D medieval world. Survive, fight enemies, and conquer the kingdom.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Remove browser extension overlays BEFORE React hydrates to prevent hydration mismatch */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function(){
                var rm = function(){
                  var els = document.querySelectorAll('[id="securlyOverlay"], .securly_overlay, .securly-center');
                  for(var i=0;i<els.length;i++) els[i].remove();
                };
                rm();
                var obs = new MutationObserver(function(mutations){
                  var found = false;
                  for(var i=0;i<mutations.length;i++){
                    var nodes = mutations[i].addedNodes;
                    for(var j=0;j<nodes.length;j++){
                      var n = nodes[j];
                      if(n.id === 'securlyOverlay' || (n.className && n.className.indexOf && n.className.indexOf('securly') !== -1)){
                        n.remove(); found = true;
                      }
                    }
                  }
                  if(found) rm();
                });
                obs.observe(document.documentElement, {childList:true, subtree:true});
                setTimeout(function(){ obs.disconnect(); }, 3000);
              })();
            `,
          }}
        />
      </head>
      <body
        className="antialiased bg-background text-foreground"
        suppressHydrationWarning
      >
        <div suppressHydrationWarning>
          {children}
        </div>
      </body>
    </html>
  );
}
