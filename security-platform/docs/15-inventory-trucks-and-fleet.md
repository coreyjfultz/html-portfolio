# 15 — Inventory, trucks and the fleet

This guide covers inventory (warehouse and trucks), receiving supplier invoices, standard truck stock and weekly counts, tools, vehicles, the daily vehicle checklist, GPS tracking with the live map, and the drive-time checks used when scheduling.

---

## Inventory

**Menu → Inventory.** Every item you stock, with the quantity in the **warehouse**, on **each truck**, and in total. Tick **Low stock only** to see what needs reordering.

### Items — **+ New item**

| Field | Notes |
|---|---|
| **SKU / part #** | Your own part number. |
| **Item name**, category, manufacturer | |
| **Unit cost**, **sell price** | Cost is used for inventory value and profit; updated from supplier invoices if you allow it. Sell price fills proposals and invoices. |
| **Reorder when total below** | Low-stock alert level (warehouse + trucks). Shown on the dashboard. |
| **Track serial numbers** | For cameras, recorders, panels…: each unit used on a job needs a serial # (and label photo) ([13](13-service-calls-and-scheduling.md#serial-numbers-and-warranty-photos)). |
| **Manufacturer warranty (months)** | Sets the warranty end date for installed units. |
| **Standard truck stock (per vehicle)** / **Most to keep on a truck** | Minimum and maximum every truck should carry ([below](#truck-stock-and-weekly-counts)). |
| **Distributor part #s** | The part numbers your distributors use for this item, comma-separated (e.g. `ADI: 1234-56, Anixter: QX-9`). Supplier invoices match on these. The system adds them by itself as you match invoice lines. |
| Active, notes | Inactive items disappear from pick lists but keep their history. |

**Product photo:** open an item → **Photo** card → **📷 Add photo** (or **Replace** / **Remove**). Use a clear picture of the product (the manufacturer's product image is ideal). The photo shows as a thumbnail in the inventory list and, if the proposal allows it, next to the item on proposals ([12](12-customers-and-sales.md#product-photos-on-the-proposal)). Owners, administrators and accounting add photos; everyone who sees inventory sees them. Photos are resized automatically.

### Moving stock

| Button | What it does |
|---|---|
| **Receive stock** | Add items to the warehouse (or a truck). Optionally records the purchase as an **expense**. Usually done through **Receiving** instead (below). |
| **Transfer / load truck** | Move items between the warehouse and a truck, or truck to truck. |
| **Physical count** | Enter the counted quantity for a location; the difference is recorded as an adjustment. |

Every movement (received, transferred, used on job SC-1042, counted, returned…) is kept in the item's **history** with who and when. **Parts used on a job are deducted from the tech's truck automatically.**

---

## Receiving (supplier invoices)

**Menu → Receiving.** Distributor invoices and packing slips become stock without typing them in.

### Three ways in

1. **Upload invoice (PDF / photo / CSV)** on the Receiving page.
2. **📷 Photo of slip:** photograph a packing slip on the phone.
3. **Email:** forward distributor emails to the private Receiving address (*Settings → Receiving → Email intake*); each PDF, photo or CSV attachment becomes an entry ([20](20-integrations.md#supplier-invoices-by-email)).

### What happens

- **CSV files** are read directly. **PDFs, photos and email text** are read automatically by the Claude API, if `ANTHROPIC_API_KEY` is set on the server ([20](20-integrations.md#claude-api)); without it, those wait for you to enter the lines by hand.
- Each line is **matched to your inventory** by part # (yours, or the distributor part #s on the item).
- If **every line matches** and the sender's email domain is on the **trusted distributor** list (*Settings → Receiving*), the invoice is **received automatically**: stock added to the warehouse, the purchase logged as an **expense**, and item **costs updated** (if *update costs* is on).
- Otherwise it waits in the **review inbox**, shown **side by side with the original document**. Fix or match lines (**+ Line**, ✕ to remove), then **Receive into stock**, or **Reject**. **Read again** re-reads the document.
- When you match a line by hand, the distributor's part # is remembered on the item, so next time it matches by itself.

Mail from senders that aren't trusted **always** waits for review, so a spoofed email can't change your stock.

---

## Truck stock and weekly counts

**Menu → Truck stock** (owners, admins, accounting) and each technician's **My Day**.

### Standard truck stock

The idea: every truck carries a **standard set** of everyday parts (batteries, contacts, wire, connectors, a spare panel or two). That means enough to work, not a pile of extras.

- On each item, **Standard truck stock (per vehicle)** is the minimum and **Most to keep on a truck** the maximum. **+ Add to standard truck stock** on the Truck stock page does the same.
- **+ Exception:** a different minimum/maximum for one truck (e.g. the fire truck carries more smoke detectors).
- For each truck the page shows what's **short** (below minimum) and what's **too many** (above maximum), with dollar values.
- **Restock from warehouse** fills the shortages in one step; **Return extras** sends the excess back.
- Items a truck keeps using from its stock but that aren't on the standard list are **suggested** for it.

### Weekly blind count

On the **count day** (*Settings → Field rules → Truck stock*, default **Friday**), each tech counts **every item and tool on their truck** from **My Day → Weekly count**. It's a *blind* count: the expected quantities aren't shown, only what they find.

When submitted:

- differences **correct the truck's stock** automatically;
- if anything's off, the **owner and the inventory manager** are alerted with the items and the **dollar value** of the difference;
- **missing tools** are flagged.

Techs get a **reminder text** on count day (if *reminders* is on), and trucks that missed their count are flagged as overdue. On Truck stock, **Mark reviewed** clears a count once someone has looked at it.

---

## Tools

**Menu → Tools.** Ladders, meters, drills, testers, fish tapes: anything that isn't a part.

| Field | Notes |
|---|---|
| Tool, **asset tag**, category, serial # | Label tools with asset tags to tell identical ones apart. |
| **Kept on vehicle** | Which truck it lives on (empty = shop). |
| Qty, status | *In service*, *Needs repair*, *Missing*. |
| Purchased, cost, last counted, notes | |

Tools are part of the **weekly truck count** and the **start-of-day check** ([13](13-service-calls-and-scheduling.md#start-of-day-equipment-check)). Missing tools alert the owner.

---

## Vehicles

**Menu → Vehicles → + New vehicle:** unit # / name, year, make, model, plate, VIN, **assigned technician**, status, current mileage, **tire pressure target (psi)** (used by the vehicle check), next service miles/date, registration and insurance expiry, GPS **tracker / vehicle ID**, **tracking page link**, **dash cam link**, notes.

The vehicle page shows:

- **On-board stock** and its value, with **Load from warehouse**, **Unload to warehouse** and **Count** per item;
- **expenses** for the vehicle (fuel, repairs; **+ Expense**);
- **vehicle check** history with photos;
- the **live location** (with tracking set up), and buttons to open the vehicle in your tracking system and its **dash cam** (owners/admins).

Service, registration and insurance dates appear on **Maintenance Due**.

---

## Vehicle checklist

*Settings → Field rules → Vehicle checklist*: how often (**Every day** (default), **Once a week**, **Off**), whether it **must be done before the first job** (default yes), and **photos** (*only when there's damage* (default) or *every check: front, back, left and right*).

On **My Day**, the tech goes through:

| Section | Items |
|---|---|
| **Under the hood** | Engine oil level; coolant and washer fluid; no leaks under the truck |
| **Tires** | **Pressure of each tire** (entered as numbers, compared with the truck's target); tread depth and sidewalls |
| **Lights** | Headlights (low/high); brake lights; turn signals and hazards; reverse lights / backup alarm; amber / work lights |
| **Walk-around** | No new dents, scratches or damage (**photos required** if there is); windshield, windows, mirrors; wipers; no warning lights on the dash; ladder rack and ladders secured; fire extinguisher and first-aid kit in the truck |
| **Clean truck** | Cab and cargo area clean and organized; outside clean |

Plus the **odometer reading** (keeps the vehicle's mileage current, which drives service reminders).

Any problem (low tire, light out, damage, warning light…) **alerts the owner and admins** with the details and photos. If the check is required, *On my way* / *Start job* wait until it's done. An approved start-of-day check also counts.

---

## GPS tracking and the live map

*Settings → Tracking & maps*. Optional; nothing here is needed to run the business.

### Connecting your tracking system

| Provider | Setup |
|---|---|
| **Samsara** | Create an API token in Samsara (read access to vehicles is enough) and paste it as *Samsara API token*. |
| **Other provider** | Either a **JSON feed URL** the app checks every few minutes (optional token), or have your provider **POST** positions to the private *push address* shown on the settings page. Each position needs a vehicle ID plus `lat`/`lng` (also accepted: `latitude`, `longitude`, `lon`; optional `speed`, `heading`, `time`, `address`). |

Then on each **vehicle**, enter its **GPS tracker / vehicle ID** exactly as the tracking system names it. *Check every (minutes)* sets how often positions are fetched (default 2).

### Address lookup (geocoding)

To put customers and sites on the map, choose *Find addresses on the map with*: **OpenStreetMap** (free, about one lookup per second, fine for a small company) or **Google Maps** (needs a Google Maps API key with the Geocoding API). Addresses are looked up in the background; unknown ones are marked *Address not found on map*.

### The live map

**Menu → Live map** (owners/admins): every truck (colored by technician, with speed and last update), **today's jobs** and the **office**. The **team panel** lists each technician: clocked in or not, current job, next job, **drive time** to it, and **whether they'll make it on time** (late ones highlighted).

## Drive-time checks when scheduling

With *Block booking a tech where they can't get there in time* **On** (default), booking or moving a job checks the drive from the tech's **previous job** (and to their **next** one), plus *Extra minutes between jobs* (default 10). If it doesn't fit, owners/admins can **Book anyway**.

Drive times come from *Drive times from*:

| Option | Notes |
|---|---|
| **Straight-line estimate** (default) | Distance ÷ *average speed* (default 30 mph). No outside service. |
| **OSRM road routing** | Real road distances, free public server (fine for light use) or your own. |
| **Google Maps with live traffic** | Most accurate; needs a Google Maps API key (Distance Matrix API); billed by Google per lookup. |

Results are cached so the same trip isn't looked up repeatedly. The map tiles (background map) come from OpenStreetMap by default; a different tile server can be set.
