import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const { incidentId, action } = await request.json();
  
  if (!incidentId || !action) {
    return new NextResponse(
      JSON.stringify({ message: 'incidentId and action are required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // In a real app, this would trigger a playbook, call a firewall API, etc.
  console.log(`Received remediation action '${action}' for incident ${incidentId}`);

  // Simulate API call
  await new Promise(resolve => setTimeout(resolve, 500));
  
  return NextResponse.json({ success: true, message: `Action '${action}' initiated for incident ${incidentId}.` });
}
