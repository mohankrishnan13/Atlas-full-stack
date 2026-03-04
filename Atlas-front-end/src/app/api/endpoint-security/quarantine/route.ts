import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const { workstationId } = await request.json();
  
  if (!workstationId) {
    return new NextResponse(
      JSON.stringify({ message: 'workstationId is required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // In a real app, you would call the Wazuh/EDR API here.
  console.log(`Received quarantine command for: ${workstationId}`);

  // Simulate API call
  await new Promise(resolve => setTimeout(resolve, 500));

  return NextResponse.json({ success: true, message: `Device ${workstationId} has been quarantined.` });
}
