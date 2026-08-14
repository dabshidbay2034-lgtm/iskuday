# Hotel Restaurant Menu Feature

## Overview
Hotels can now add a dedicated **Menu** section to their hotel pages to showcase their restaurant's food and drinks with prices, descriptions, and images. This works just like the existing page editor for rooms, allowing full customization and editing.

## What Was Added

### 1. New Section Type: "Menu"
- **Type**: `menu` (added to `LeafSectionType`)
- **Purpose**: Display food and drink items with prices and photos
- **Location**: Can be added anywhere on the hotel page like other sections

### 2. MenuItem Data Structure
```typescript
interface MenuItem {
  id: string;           // Unique identifier
  name: string;         // Item name (e.g., "Chicken Biryani")
  description?: string; // Optional description
  price: number;        // Price (in local currency)
  imageUrl?: string;    // Image URL (supports data URLs)
  category?: string;    // Category (e.g., "Main course", "Drinks")
}
```

### 3. Page Section Updates
- Added `items?: MenuItem[]` to `PageSection` interface
- `menu` is now included in `LEAF_SECTION_TYPES`
- Added to `SECTION_ORDER` for the "Add a block" menu

### 4. Styling Support
- Menu sections support the same layout options as rooms:
  - **Columns**: 1, 2, 3, or auto layout
  - **Width**: Narrow or wide container
  - **Padding**: Tight, normal, or roomy spacing
- Each template (Beachfront, Business, Boutique) includes menu styling

### 5. Editor Component
The menu editor in the Inspector panel (`SectionFields.tsx`) includes:
- Title and subtitle editing
- Add/remove menu items
- For each item:
  - Name (required)
  - Category (optional)
  - Description (optional, multiline)
  - Price (number, supports decimals)
  - Image upload with preview
  - Image deletion

### 6. Public Display
The menu renders on published hotel pages with:
- Item name and category
- Description (truncated to 2 lines if very long)
- Item image (or gradient placeholder if no image)
- Price formatted in the hotel's currency
- Responsive grid layout (1 column on mobile, 2-3 on desktop based on settings)

## How to Use

### For Hotel Owners

1. **Go to the hotel page editor** (`/manage/hotels/:id`)
2. **Add a Menu section**:
   - Click in the canvas or use the panel
   - Click "Add a block" in the editor
   - Select "Menu" from the options
3. **Edit the menu section**:
   - In the Inspector panel (right side on desktop, bottom sheet on mobile)
   - Edit section title (e.g., "Our Menu")
   - Edit subtitle (e.g., "Food & Drinks")
4. **Add menu items**:
   - Click "Add item" in the Inspector
   - Fill in:
     - Item name (required)
     - Category (e.g., "Breakfast", "Main Courses")
     - Description (optional)
     - Price (numbers with decimals supported)
   - Upload an image (click the upload area)
5. **Style the section**:
   - Use the "Look" tab to adjust:
     - **Columns**: How many items per row (1, 2, or 3)
     - **Width**: Container width (narrow/wide)
     - **Spacing**: Padding around section
6. **Save and publish** the page

### Adding Multiple Dishes
- Each item added appears as a card in the menu grid
- Items display in the order added
- Remove items by clicking the trash icon on any item
- Edit items by clicking into their fields

## Technical Details

### Files Modified
1. **src/components/hotel/page-sections.ts**
   - Added `MenuItem` interface
   - Added `menu` to `LeafSectionType`
   - Updated `LEAF_SECTION_TYPES` and `SECTION_ORDER`
   - Added `items` field to `PageSection`
   - Added `menu` case to `newSection()`

2. **src/components/hotel/PageSectionView.tsx**
   - Added rendering for `menu` section type
   - Displays menu items in a grid with images, names, descriptions, and prices
   - Shows placeholder for empty menus in edit mode
   - Uses hotel's accent color for prices

3. **src/components/hotel/SectionFields.tsx**
   - Added `menu` case to `ContentFields`
   - Created `MenuItemsEditor` component with full CRUD interface
   - Supports image upload with data URLs

4. **src/components/hotel/section-styles.ts**
   - Added `menu` to `STYLE_AXES_FOR` with columns, width, and padding support

5. **src/components/hotel/page-templates.ts**
   - Added `menu` styling to all three page templates (Beachfront, Business, Boutique)
   - Menu items display with 2-3 columns depending on template

### Data Storage
- Menu items are stored in the hotel's `sections` JSONB column
- Structure: `sections[].type === "menu"` sections contain `items: MenuItem[]`
- Fully compatible with existing hotel page save/load cycle
- No new database tables required

### Image Handling
- Currently uses data URLs (base64 encoding)
- For production optimization, consider integrating with Supabase storage like gallery images do
- Images are inline in the section data, no separate storage cleanup needed

## Example Menu Section

```json
{
  "id": "menu-1",
  "type": "menu",
  "title": "Restaurant Menu",
  "subtitle": "Breakfast & Lunch",
  "columns": 3,
  "width": "wide",
  "pad": "normal",
  "items": [
    {
      "id": "item-1",
      "name": "Sambusas",
      "category": "Appetizers",
      "description": "Crispy pastry with savory filling",
      "price": 2.50,
      "imageUrl": "data:image/jpeg;base64,..."
    },
    {
      "id": "item-2",
      "name": "Goat Stew",
      "category": "Main Course",
      "description": "Tender goat meat in aromatic sauce",
      "price": 8.00,
      "imageUrl": "data:image/jpeg;base64,..."
    }
  ]
}
```

## Features

✅ Full CRUD interface for menu items  
✅ Image uploads for each item  
✅ Category, description, and pricing  
✅ Responsive grid layout (1-3 columns)  
✅ Styling options (width, spacing, columns)  
✅ Works in page editor (canvas + inspector)  
✅ Renders on published pages  
✅ Integrated with existing page system  
✅ No database migrations needed  

## Future Enhancements

- [ ] Integrate with Supabase Storage for images (like gallery)
- [ ] Reorder menu items (drag/drop)
- [ ] Price currency selection per item
- [ ] Dietary restrictions/allergies badges
- [ ] Menu categories as collapsible sections
- [ ] Export menu as PDF
- [ ] QR code for digital menu
- [ ] Inventory tracking for items

## Testing Checklist

- [x] Menu section adds to page without errors
- [x] Menu items can be added and removed
- [x] Images can be uploaded (data URL)
- [x] Price, name, category, and description all save
- [x] Menu renders on published pages
- [x] Layout options work (columns, width, spacing)
- [x] All three templates include menu styling
- [x] TypeScript compilation passes
- [x] No runtime errors

## Notes

- The menu section reuses the same styling system as the rooms section
- Menu items are ordered by creation (no custom reordering UI yet)
- Images use data URLs; consider migrating to Supabase storage for better performance
- The feature integrates seamlessly with the existing hotel page builder
