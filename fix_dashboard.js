const fs = require('fs')
let c = fs.readFileSync('src/ui/src/app/components/Dashboard.tsx', 'utf8')
c = c.replace(/var\(--theme-accent-bg\)/g, 'var(--condition-accent-bg)')
c = c.replace(/var\(--theme-border\)/g, 'var(--condition-border)')
c = c.replace(/iconColor: "var\(--shell-primary\)"/g, 'iconColor: "var(--condition-primary)"')
c = c.replace(/textColor: "var\(--shell-primary\)"/g, 'textColor: "var(--condition-primary)"')
c = c.replace(
  /mutedColor: "var\(--shell-header-sub\)"/g,
  'mutedColor: "var(--condition-header-sub)"',
)
fs.writeFileSync('src/ui/src/app/components/Dashboard.tsx', c)
